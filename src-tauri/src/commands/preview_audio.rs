use lazy_static::lazy_static;
use pitch_shift::{Shifter, TOTAL_F32};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::File,
    io::BufReader,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant},
};

const PITCH_SHIFT_INPUT_FRAMES: usize = 128;
type PitchShiftState = Box<[f32; TOTAL_F32]>;

struct PitchPreservingSource<I>
where
    I: Source<Item = f32>,
{
    input: I,
    shifters: Vec<Shifter<PitchShiftState>>,
    input_channels: Vec<[f32; PITCH_SHIFT_INPUT_FRAMES]>,
    output_channels: Vec<Vec<f32>>,
    output: VecDeque<f32>,
    speed: f32,
    output_frame_remainder: f32,
    finished: bool,
}

impl<I> PitchPreservingSource<I>
where
    I: Source<Item = f32>,
{
    /// Crée une source qui modifie le tempo sans modifier la hauteur du signal.
    fn new(input: I, speed: f32) -> Self {
        let channels = input.channels() as usize;
        let shifters = (0..channels)
            .map(|_| {
                let state = vec![0.0; TOTAL_F32]
                    .into_boxed_slice()
                    .try_into()
                    .expect("pitch shift state has a fixed size");
                Shifter::new(state)
            })
            .collect();
        Self {
            input,
            shifters,
            input_channels: vec![[0.0; PITCH_SHIFT_INPUT_FRAMES]; channels],
            output_channels: vec![Vec::new(); channels],
            output: VecDeque::new(),
            speed: speed.clamp(0.25, 4.0),
            output_frame_remainder: 0.0,
            finished: false,
        }
    }

    /// Transforme le prochain bloc entrelacé et remplit la file de sortie.
    fn process_next_block(&mut self) -> bool {
        if self.finished {
            return false;
        }

        self.input_channels
            .iter_mut()
            .for_each(|channel| channel.fill(0.0));
        let channels = self.input_channels.len();
        let mut samples_read = 0;
        'frames: for frame in 0..PITCH_SHIFT_INPUT_FRAMES {
            for channel in 0..channels {
                let Some(sample) = self.input.next() else {
                    self.finished = true;
                    break 'frames;
                };
                self.input_channels[channel][frame] = sample;
                samples_read += 1;
            }
        }
        if samples_read == 0 {
            return false;
        }

        self.output_frame_remainder += PITCH_SHIFT_INPUT_FRAMES as f32 / self.speed;
        let output_frames = self.output_frame_remainder.floor() as usize;
        self.output_frame_remainder -= output_frames as f32;
        for channel in 0..channels {
            let shifted = self.shifters[channel].shift(
                &self.input_channels[channel],
                0.0,
                output_frames,
                self.input.sample_rate() as f32,
            );
            self.output_channels[channel].clear();
            self.output_channels[channel].extend_from_slice(shifted);
        }
        for frame in 0..output_frames {
            for channel in 0..channels {
                self.output.push_back(self.output_channels[channel][frame]);
            }
        }
        true
    }
}

impl<I> Iterator for PitchPreservingSource<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    /// Retourne le prochain échantillon dont le tempo a été transformé.
    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Some(sample) = self.output.pop_front() {
                return Some(sample);
            }
            if !self.process_next_block() {
                return None;
            }
        }
    }
}

impl<I> Source for PitchPreservingSource<I>
where
    I: Source<Item = f32>,
{
    /// Retourne le nombre d'échantillons actuellement prêts.
    fn current_frame_len(&self) -> Option<usize> {
        (!self.output.is_empty()).then_some(self.output.len())
    }

    /// Retourne le nombre de canaux de la source originale.
    fn channels(&self) -> u16 {
        self.input.channels()
    }

    /// Retourne la fréquence d'échantillonnage de la source originale.
    fn sample_rate(&self) -> u32 {
        self.input.sample_rate()
    }

    /// Retourne la durée de lecture après application du tempo.
    fn total_duration(&self) -> Option<Duration> {
        self.input
            .total_duration()
            .map(|duration| Duration::from_secs_f64(duration.as_secs_f64() / self.speed as f64))
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewAudioAction {
    Load,
    Play,
    Pause,
    Seek,
    SetVolume,
    SetSpeed,
    Status,
    Unload,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAudioStatus {
    loaded: bool,
    playing: bool,
    ended: bool,
    position_ms: f64,
    duration_ms: f64,
    speed: f32,
}

struct PreviewAudioRequest {
    action: PreviewAudioAction,
    file_path: Option<String>,
    position_ms: Option<f64>,
    duration_ms: Option<f64>,
    volume: Option<f32>,
    speed: Option<f32>,
    response: Sender<Result<PreviewAudioStatus, String>>,
}

struct PreviewAudioService {
    sender: Sender<PreviewAudioRequest>,
}

impl PreviewAudioService {
    /// Crée le thread qui conserve le périphérique et le lecteur audio natif.
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || run_preview_audio_thread(receiver));
        Self { sender }
    }

    /// Envoie une commande au thread audio et attend son état résultant.
    fn request(
        &self,
        action: PreviewAudioAction,
        file_path: Option<String>,
        position_ms: Option<f64>,
        duration_ms: Option<f64>,
        volume: Option<f32>,
        speed: Option<f32>,
    ) -> Result<PreviewAudioStatus, String> {
        let (response, receiver) = mpsc::channel();
        self.sender
            .send(PreviewAudioRequest {
                action,
                file_path,
                position_ms,
                duration_ms,
                volume,
                speed,
                response,
            })
            .map_err(|error| error.to_string())?;
        receiver.recv().map_err(|error| error.to_string())?
    }
}

struct PreviewAudioRuntime {
    _output_stream: Option<OutputStream>,
    output_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    loaded_path: Option<String>,
    position_ms: f64,
    duration_ms: f64,
    speed: f32,
    started_at: Option<Instant>,
}

impl PreviewAudioRuntime {
    /// Crée un lecteur vide dont le périphérique sera ouvert au premier chargement.
    fn new() -> Self {
        Self {
            _output_stream: None,
            output_handle: None,
            sink: None,
            loaded_path: None,
            position_ms: 0.0,
            duration_ms: 0.0,
            speed: 1.0,
            started_at: None,
        }
    }

    /// Ouvre une seule fois le périphérique audio par défaut.
    fn ensure_output(&mut self) -> Result<(), String> {
        if self.output_handle.is_some() {
            return Ok(());
        }

        let (stream, handle) = OutputStream::try_default().map_err(|error| error.to_string())?;
        self._output_stream = Some(stream);
        self.output_handle = Some(handle);
        Ok(())
    }

    /// Ajoute le décodeur directement à 1x ou avec conservation du pitch aux autres vitesses.
    fn append_decoder(&self, sink: &Sink, decoder: Decoder<BufReader<File>>) {
        if (self.speed - 1.0).abs() < f32::EPSILON {
            sink.append(decoder);
        } else {
            sink.append(PitchPreservingSource::new(
                decoder.convert_samples::<f32>(),
                self.speed,
            ));
        }
    }

    /// Charge un fichier uniquement lorsqu'il diffère du fichier déjà prêt.
    fn load(
        &mut self,
        file_path: String,
        position_ms: Option<f64>,
        expected_duration_ms: Option<f64>,
        volume: Option<f32>,
        speed: Option<f32>,
    ) -> Result<(), String> {
        let should_reload = self.loaded_path.as_deref() != Some(file_path.as_str())
            || self.sink.as_ref().map_or(true, Sink::empty);
        if should_reload {
            if let Some(speed) = speed {
                self.speed = speed.clamp(0.25, 4.0);
            }
            self.ensure_output()?;
            let file = File::open(&file_path).map_err(|error| error.to_string())?;
            let decoder = Decoder::new(BufReader::new(file)).map_err(|error| error.to_string())?;
            let decoded_duration_ms = decoder
                .total_duration()
                .map(|duration| duration.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            let duration_ms = expected_duration_ms
                .filter(|duration| duration.is_finite() && *duration > 0.0)
                .unwrap_or(decoded_duration_ms);
            let sink = Sink::try_new(self.output_handle.as_ref().unwrap())
                .map_err(|error| error.to_string())?;
            sink.pause();
            self.append_decoder(&sink, decoder);
            self.sink = Some(sink);
            self.loaded_path = Some(file_path);
            self.position_ms = 0.0;
            self.duration_ms = duration_ms;
            self.started_at = None;
        }

        if !should_reload {
            if let Some(speed) = speed {
                self.set_speed(speed)?;
            }
        }
        if let Some(volume) = volume {
            self.set_volume(volume);
        }
        if let Some(position_ms) = position_ms {
            self.seek(position_ms)?;
        }
        Ok(())
    }

    /// Met à jour la position logique depuis l'horloge monotone du thread audio.
    fn sync_position(&mut self) {
        let Some(started_at) = self.started_at else {
            return;
        };
        let now = Instant::now();
        self.position_ms +=
            now.duration_since(started_at).as_secs_f64() * 1000.0 * self.speed as f64;
        let advancing = self
            .sink
            .as_ref()
            .is_some_and(|sink| !sink.is_paused() && !sink.empty());
        self.started_at = advancing.then_some(now);
    }

    /// Recrée le flux à la position demandée tout en conservant le périphérique audio ouvert.
    fn seek(&mut self, position_ms: f64) -> Result<(), String> {
        self.sync_position();
        let position_ms = position_ms.max(0.0);
        let was_playing = self
            .sink
            .as_ref()
            .is_some_and(|sink| !sink.is_paused() && !sink.empty());
        let volume = self.sink.as_ref().map_or(1.0, Sink::volume);
        let file_path = self
            .loaded_path
            .as_ref()
            .ok_or("No native audio loaded")?
            .clone();
        self.ensure_output()?;
        let file = File::open(file_path).map_err(|error| error.to_string())?;
        let mut decoder = Decoder::new(BufReader::new(file)).map_err(|error| error.to_string())?;
        let decoded_duration_ms = decoder
            .total_duration()
            .map(|duration| duration.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        let duration_gap_ms = self.duration_ms - decoded_duration_ms;
        let refine_last_second = duration_gap_ms > 1.0
            && duration_gap_ms <= 1000.0
            && position_ms >= decoded_duration_ms;
        let decoder_seek_ms = if refine_last_second {
            (decoded_duration_ms - 2.0).max(0.0)
        } else {
            position_ms
        };
        decoder
            .try_seek(Duration::from_secs_f64(decoder_seek_ms / 1000.0))
            .map_err(|error| error.to_string())?;
        if refine_last_second {
            // Rodio 0.20 perd la fraction de seconde de Symphonia et borne sinon ce seek trop loin.
            let frames_to_skip = ((position_ms - decoder_seek_ms) * decoder.sample_rate() as f64
                / 1000.0)
                .round() as usize;
            let samples_to_skip = frames_to_skip.saturating_mul(decoder.channels() as usize);
            for _ in 0..samples_to_skip {
                if decoder.next().is_none() {
                    break;
                }
            }
        }
        let sink = Sink::try_new(self.output_handle.as_ref().unwrap())
            .map_err(|error| error.to_string())?;
        sink.pause();
        sink.set_volume(volume);
        self.append_decoder(&sink, decoder);
        if was_playing {
            sink.play();
        }
        if let Some(previous_sink) = self.sink.replace(sink) {
            previous_sink.stop();
        }

        self.position_ms = position_ms;
        self.started_at = was_playing.then(Instant::now);
        Ok(())
    }

    /// Lance ou reprend la lecture du fichier déjà chargé.
    fn play(&mut self) -> Result<(), String> {
        self.sync_position();
        let sink = self.sink.as_ref().ok_or("No native audio loaded")?;
        sink.play();
        self.started_at = Some(Instant::now());
        Ok(())
    }

    /// Met en pause le lecteur tout en figeant sa position courante.
    fn pause(&mut self) {
        self.sync_position();
        if let Some(sink) = &self.sink {
            sink.pause();
        }
        self.started_at = None;
    }

    /// Applique le volume linéaire natif, y compris au-dessus de 100 %.
    fn set_volume(&mut self, volume: f32) {
        if let Some(sink) = &self.sink {
            sink.set_volume(volume.clamp(0.0, 2.0));
        }
    }

    /// Applique la vitesse en conservant une position logique continue.
    fn set_speed(&mut self, speed: f32) -> Result<(), String> {
        self.sync_position();
        let speed = speed.clamp(0.25, 4.0);
        if (self.speed - speed).abs() < f32::EPSILON {
            return Ok(());
        }
        self.speed = speed;
        if self.sink.is_some() {
            self.seek(self.position_ms)?;
        }
        Ok(())
    }

    /// Décharge le fichier courant en conservant le périphérique audio ouvert.
    fn unload(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.loaded_path = None;
        self.position_ms = 0.0;
        self.duration_ms = 0.0;
        self.started_at = None;
    }

    /// Retourne un instantané sérialisable de l'état du lecteur.
    fn status(&mut self) -> PreviewAudioStatus {
        self.sync_position();
        let loaded = self.sink.is_some();
        let ended = loaded && self.sink.as_ref().is_some_and(Sink::empty);
        PreviewAudioStatus {
            loaded,
            playing: loaded && !ended && self.sink.as_ref().is_some_and(|sink| !sink.is_paused()),
            ended,
            position_ms: self.position_ms,
            duration_ms: self.duration_ms,
            speed: self.speed,
        }
    }

    /// Exécute une commande reçue du frontend sur le lecteur persistant.
    fn handle(&mut self, request: &PreviewAudioRequest) -> Result<PreviewAudioStatus, String> {
        match request.action {
            PreviewAudioAction::Load => self.load(
                request
                    .file_path
                    .clone()
                    .ok_or("Missing native audio path")?,
                request.position_ms,
                request.duration_ms,
                request.volume,
                request.speed,
            )?,
            PreviewAudioAction::Play => {
                if self.sink.as_ref().map_or(true, Sink::empty) {
                    self.load(
                        request
                            .file_path
                            .clone()
                            .ok_or("Missing native audio path")?,
                        None,
                        request.duration_ms,
                        request.volume,
                        request.speed,
                    )?;
                }
                if let Some(position_ms) = request.position_ms {
                    self.seek(position_ms)?;
                }
                if let Some(volume) = request.volume {
                    self.set_volume(volume);
                }
                if let Some(speed) = request.speed {
                    self.set_speed(speed)?;
                }
                self.play()?;
            }
            PreviewAudioAction::Pause => self.pause(),
            PreviewAudioAction::Seek => {
                self.seek(request.position_ms.ok_or("Missing native audio position")?)?
            }
            PreviewAudioAction::SetVolume => {
                self.set_volume(request.volume.ok_or("Missing native audio volume")?)
            }
            PreviewAudioAction::SetSpeed => {
                self.set_speed(request.speed.ok_or("Missing native audio speed")?)?
            }
            PreviewAudioAction::Status => {}
            PreviewAudioAction::Unload => self.unload(),
        }
        Ok(self.status())
    }
}

/// Traite séquentiellement les commandes afin de conserver les objets audio non transférables.
fn run_preview_audio_thread(receiver: Receiver<PreviewAudioRequest>) {
    let mut runtime = PreviewAudioRuntime::new();
    while let Ok(request) = receiver.recv() {
        let result =
            catch_unwind(AssertUnwindSafe(|| runtime.handle(&request))).unwrap_or_else(|_| {
                runtime = PreviewAudioRuntime::new();
                Err("Native audio service failed".to_string())
            });
        let _ = request.response.send(result);
    }
}

lazy_static! {
    static ref PREVIEW_AUDIO_SERVICE: PreviewAudioService = PreviewAudioService::new();
}

/// Pilote le lecteur audio natif persistant de la prévisualisation.
#[tauri::command(async)]
pub fn control_preview_audio(
    action: PreviewAudioAction,
    file_path: Option<String>,
    position_ms: Option<f64>,
    duration_ms: Option<f64>,
    volume: Option<f32>,
    speed: Option<f32>,
) -> Result<PreviewAudioStatus, String> {
    PREVIEW_AUDIO_SERVICE.request(action, file_path, position_ms, duration_ms, volume, speed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use std::f32::consts::TAU;

    /// Vérifie que doubler le tempo conserve la fréquence fondamentale du signal.
    #[test]
    fn doubles_tempo_without_raising_pitch() {
        const SAMPLE_RATE: u32 = 48_000;
        const FREQUENCY: f32 = 440.0;
        let input = (0..SAMPLE_RATE)
            .map(|sample| (TAU * FREQUENCY * sample as f32 / SAMPLE_RATE as f32).sin())
            .collect::<Vec<_>>();
        let source = SamplesBuffer::new(1, SAMPLE_RATE, input);

        let output = PitchPreservingSource::new(source, 2.0).collect::<Vec<_>>();
        let duration = output.len() as f32 / SAMPLE_RATE as f32;
        let analyzed = &output[(SAMPLE_RATE as usize / 20).min(output.len())..];
        let positive_crossings = analyzed
            .windows(2)
            .filter(|samples| samples[0] <= 0.0 && samples[1] > 0.0)
            .count();
        let measured_frequency =
            positive_crossings as f32 / (analyzed.len() as f32 / SAMPLE_RATE as f32);

        assert!((0.45..=0.55).contains(&duration));
        assert!((420.0..=460.0).contains(&measured_frequency));
    }
}
