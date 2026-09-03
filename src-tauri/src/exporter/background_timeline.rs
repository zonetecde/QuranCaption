use super::types::VideoClipTransitionMode;

/// Construit une timeline de fond en conservant les espaces entre les clips.
///
/// # Arguments
/// * `filter_lines` - Lignes du filtre complexe à compléter.
/// * `labels` - Labels vidéo normalisés à assembler.
/// * `durations_s` - Durée de chaque label en secondes.
/// * `timeline_offsets_s` - Position de chaque label dans la plage exportée.
/// * `width` - Largeur de sortie.
/// * `height` - Hauteur de sortie.
/// * `fps` - Fréquence d'images de sortie.
/// * `total_duration_s` - Durée totale de la plage exportée.
/// * `mode` - Mode de transition demandé.
/// * `transition_s` - Durée de transition en secondes.
///
/// # Retourne
/// Le label vidéo final couvrant toute la timeline.
#[allow(clippy::too_many_arguments)]
pub(super) fn build_timed_background_chain(
    filter_lines: &mut Vec<String>,
    labels: &[String],
    durations_s: &[f64],
    timeline_offsets_s: &[f64],
    width: i32,
    height: i32,
    fps: i32,
    total_duration_s: f64,
    mode: VideoClipTransitionMode,
    transition_s: f64,
) -> String {
    let uses_timeline_crossfades = mode == VideoClipTransitionMode::Crossfade
        && (timeline_offsets_s.first().copied().unwrap_or(0.0).abs() > 0.0011
            || (1..labels.len()).any(|index| {
                let expected_offset = timeline_offsets_s.get(index - 1).copied().unwrap_or(0.0)
                    + durations_s.get(index - 1).copied().unwrap_or(0.0);
                (timeline_offsets_s
                    .get(index)
                    .copied()
                    .unwrap_or(expected_offset)
                    - expected_offset)
                    .abs()
                    > 0.0011
            }));
    let mut segments: Vec<(String, f64)> = Vec::new();
    let mut cursor_s = 0.0;
    let mut clip_index = 0usize;
    let mut gap_index = 0usize;

    while clip_index < labels.len() {
        let run_offset_s = timeline_offsets_s
            .get(clip_index)
            .copied()
            .unwrap_or(cursor_s)
            .max(0.0);
        let starts_after_gap = run_offset_s > cursor_s + 1e-6;
        if starts_after_gap {
            let gap_duration_s = run_offset_s - cursor_s;
            let gap_label = format!("bgap{}", gap_index);
            filter_lines.push(format!(
                "color=c=black:s={}x{}:r={}:d={:.6},format=yuv420p,setsar=1[{}]",
                width, height, fps, gap_duration_s, gap_label
            ));
            segments.push((gap_label, gap_duration_s));
            gap_index += 1;
        }

        let mut run_end = clip_index + 1;
        let mut expected_offset_s = run_offset_s
            + durations_s
                .get(clip_index)
                .copied()
                .unwrap_or(0.001)
                .max(0.001);
        while run_end < labels.len() {
            let next_offset_s = timeline_offsets_s
                .get(run_end)
                .copied()
                .unwrap_or(expected_offset_s);
            let continues_run = if uses_timeline_crossfades {
                next_offset_s <= expected_offset_s + 1e-6
            } else {
                (next_offset_s - expected_offset_s).abs() <= 1e-6
            };
            if !continues_run {
                break;
            }
            expected_offset_s += durations_s
                .get(run_end)
                .copied()
                .unwrap_or(0.001)
                .max(0.001);
            if uses_timeline_crossfades {
                expected_offset_s = next_offset_s
                    + durations_s
                        .get(run_end)
                        .copied()
                        .unwrap_or(0.001)
                        .max(0.001);
            }
            run_end += 1;
        }

        let run_durations = &durations_s[clip_index..run_end];
        let run_label = if run_end - clip_index == 1 {
            labels[clip_index].clone()
        } else if uses_timeline_crossfades {
            build_timeline_crossfade_chain(
                filter_lines,
                &labels[clip_index..run_end],
                run_durations,
                &timeline_offsets_s[clip_index..run_end],
            )
        } else {
            build_background_transition_chain(
                filter_lines,
                &labels[clip_index..run_end],
                run_durations,
                mode,
                transition_s,
            )
        };
        let run_duration_s = if uses_timeline_crossfades {
            (clip_index..run_end)
                .map(|index| {
                    timeline_offsets_s
                        .get(index)
                        .copied()
                        .unwrap_or(run_offset_s)
                        + durations_s.get(index).copied().unwrap_or(0.001).max(0.001)
                })
                .fold(run_offset_s, f64::max)
                - run_offset_s
        } else if mode == VideoClipTransitionMode::Crossfade
            && transition_s > 1e-6
            && run_durations.len() > 1
        {
            run_durations
                .iter()
                .skip(1)
                .fold(run_durations[0].max(0.001), |current, duration| {
                    let next = duration.max(0.001);
                    current + next - transition_s.min(current).min(next)
                })
        } else {
            run_durations.iter().sum()
        };
        let next_offset_s = timeline_offsets_s
            .get(run_end)
            .copied()
            .unwrap_or(total_duration_s);
        let ends_before_gap = next_offset_s > run_offset_s + run_duration_s + 1e-6;
        let run_label = if mode == VideoClipTransitionMode::FadeThroughBlack
            && transition_s > 1e-6
            && (starts_after_gap || ends_before_gap)
        {
            let mut filters = Vec::new();
            if starts_after_gap {
                let fade_s = transition_s.min(run_durations[0].max(0.001) / 2.0);
                filters.push(format!("fade=t=in:st=0:d={:.6}", fade_s));
            }
            if ends_before_gap {
                let fade_s = transition_s
                    .min(run_durations.last().copied().unwrap_or(0.001).max(0.001) / 2.0);
                filters.push(format!(
                    "fade=t=out:st={:.6}:d={:.6}",
                    (run_duration_s - fade_s).max(0.0),
                    fade_s
                ));
            }
            let faded_label = format!("bgfade{}", clip_index);
            filter_lines.push(format!(
                "[{}]{}[{}]",
                run_label,
                filters.join(","),
                faded_label
            ));
            faded_label
        } else {
            run_label
        };
        segments.push((run_label, run_duration_s));
        cursor_s = run_offset_s + run_duration_s;
        clip_index = run_end;
    }

    if cursor_s + 1e-6 < total_duration_s {
        let gap_duration_s = total_duration_s - cursor_s;
        let gap_label = format!("bgap{}", gap_index);
        filter_lines.push(format!(
            "color=c=black:s={}x{}:r={}:d={:.6},format=yuv420p,setsar=1[{}]",
            width, height, fps, gap_duration_s, gap_label
        ));
        segments.push((gap_label, gap_duration_s));
    }

    let mut inputs = String::new();
    for (index, (label, duration_s)) in segments.iter().enumerate() {
        let normalized_label = format!("bgtimed{}", index);
        filter_lines.push(format!(
            "[{}]trim=start=0:end={:.6},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[{}]",
            label, duration_s, normalized_label
        ));
        inputs.push_str(&format!("[{}]", normalized_label));
    }
    filter_lines.push(format!(
        "{}concat=n={}:v=1:a=0[bgtimeline]",
        inputs,
        segments.len()
    ));
    "bgtimeline".to_string()
}

/// Construit une chaîne de crossfades dont chaque durée vient du chevauchement de la timeline.
fn build_timeline_crossfade_chain(
    filter_lines: &mut Vec<String>,
    labels: &[String],
    durations_s: &[f64],
    timeline_offsets_s: &[f64],
) -> String {
    let normalized_labels: Vec<String> = labels
        .iter()
        .enumerate()
        .map(|(index, label)| {
			let out = format!("{}tx{}", label, index);
			filter_lines.push(format!(
				"[{}]setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv444p,setsar=1[{}]",
				label, out
			));
			out
		})
		.collect();
    let run_start_s = timeline_offsets_s.first().copied().unwrap_or(0.0);
    let mut current = normalized_labels[0].clone();

    for index in 0..(normalized_labels.len() - 1) {
        let current_start_s = timeline_offsets_s
            .get(index)
            .copied()
            .unwrap_or(run_start_s);
        let current_duration_s = durations_s.get(index).copied().unwrap_or(0.001).max(0.001);
        let next_start_s = timeline_offsets_s
            .get(index + 1)
            .copied()
            .unwrap_or(current_start_s + current_duration_s);
        let next_duration_s = durations_s
            .get(index + 1)
            .copied()
            .unwrap_or(0.001)
            .max(0.001);
        let fade_s = (current_start_s + current_duration_s - next_start_s)
            .max(0.0)
            .min(current_duration_s)
            .min(next_duration_s);
        let out = format!("{}tc{}", labels[index + 1], index);

        if fade_s <= 1e-6 {
            filter_lines.push(format!(
                "[{}][{}]concat=n=2:v=1:a=0[{}]",
                current,
                normalized_labels[index + 1],
                out
            ));
        } else {
            filter_lines.push(format!(
				"[{}][{}]xfade=transition=fade:duration={:.6}:offset={:.6},setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv444p,setsar=1[{}]",
				current,
				normalized_labels[index + 1],
				fade_s,
				(next_start_s - run_start_s).max(0.0),
				out
			));
        }
        current = out;
    }

    current
}

/// Construit la chaîne FFmpeg des vidéos de fond avec transition optionnelle.
///
/// # Arguments
/// * `filter_lines` - Lignes du filtre complexe à compléter.
/// * `labels` - Labels vidéo normalisés à assembler.
/// * `durations_s` - Durée de chaque label en secondes.
/// * `mode` - Mode de transition demandé.
/// * `transition_s` - Durée de transition en secondes.
///
/// # Retourne
/// Le label vidéo final à utiliser comme fond.
pub(super) fn build_background_transition_chain(
    filter_lines: &mut Vec<String>,
    labels: &[String],
    durations_s: &[f64],
    mode: VideoClipTransitionMode,
    transition_s: f64,
) -> String {
    if labels.len() <= 1 || mode == VideoClipTransitionMode::None || transition_s <= 1e-6 {
        let mut inputs = String::new();
        for label in labels {
            inputs.push_str(&format!("[{}]", label));
        }
        let out = "bgcat".to_string();
        filter_lines.push(format!(
            "{}concat=n={}:v=1:a=0[{}]",
            inputs,
            labels.len(),
            out
        ));
        return out;
    }

    match mode {
        VideoClipTransitionMode::FadeThroughBlack => {
            let mut inputs = String::new();
            for (index, label) in labels.iter().enumerate() {
                let duration_s = durations_s.get(index).copied().unwrap_or(0.0).max(0.001);
                let fade_s = transition_s.min(duration_s / 2.0);
                let mut filters = Vec::new();
                if index > 0 {
                    filters.push(format!("fade=t=in:st=0:d={:.6}", fade_s));
                }
                if index + 1 < labels.len() {
                    filters.push(format!(
                        "fade=t=out:st={:.6}:d={:.6}",
                        (duration_s - fade_s).max(0.0),
                        fade_s
                    ));
                }

                let out = format!("bgb{}", index);
                if filters.is_empty() {
                    filter_lines.push(format!("[{}]setpts=PTS-STARTPTS[{}]", label, out));
                } else {
                    filter_lines.push(format!("[{}]{}[{}]", label, filters.join(","), out));
                }
                inputs.push_str(&format!("[{}]", out));
            }

            filter_lines.push(format!(
                "{}concat=n={}:v=1:a=0[bgcat]",
                inputs,
                labels.len()
            ));
            "bgcat".to_string()
        }
        VideoClipTransitionMode::Crossfade => {
            let normalized_labels: Vec<String> = labels
                .iter()
                .enumerate()
                .map(|(index, label)| {
                    let out = format!("bgxf{}", index);
                    filter_lines.push(format!(
                        "[{}]setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv444p,setsar=1[{}]",
                        label, out
                    ));
                    out
                })
                .collect();
            let mut current = normalized_labels[0].clone();
            let mut current_duration = durations_s.first().copied().unwrap_or(0.001).max(0.001);

            for index in 0..(normalized_labels.len() - 1) {
                let next_duration = durations_s
                    .get(index + 1)
                    .copied()
                    .unwrap_or(0.001)
                    .max(0.001);
                let fade_s = transition_s.min(current_duration).min(next_duration);
                let out = format!("bgx{}", index);
                if fade_s <= 1e-6 {
                    filter_lines.push(format!(
                        "[{}][{}]concat=n=2:v=1:a=0[{}]",
                        current,
                        normalized_labels[index + 1],
                        out
                    ));
                    current_duration += next_duration;
                } else {
                    filter_lines.push(format!(
                        "[{}][{}]xfade=transition=fade:duration={:.6}:offset={:.6},setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv444p,setsar=1[{}]",
                        current,
                        normalized_labels[index + 1],
                        fade_s,
                        (current_duration - fade_s).max(0.0),
                        out
                    ));
                    current_duration = current_duration + next_duration - fade_s;
                }
                current = out;
            }

            current
        }
        VideoClipTransitionMode::None => unreachable!(),
    }
}

#[cfg(test)]
mod trim_tests {
    use super::*;

    /// Vérifie que les espaces avant, entre et après les clips sont conservés.
    #[test]
    fn preserves_gaps_around_trimmed_video_clips() {
        let mut filters = Vec::new();
        let label = build_timed_background_chain(
            &mut filters,
            &["first".to_string(), "second".to_string()],
            &[2.0, 1.0],
            &[1.0, 5.0],
            1920,
            1080,
            30,
            8.0,
            VideoClipTransitionMode::None,
            0.0,
        );

        assert_eq!(label, "bgtimeline");
        assert!(filters.iter().any(|line| line.contains("d=1.000000")));
        assert_eq!(
            filters
                .iter()
                .filter(|line| line.starts_with("color=c=black"))
                .count(),
            3
        );
        assert!(filters.iter().any(|line| line.contains("concat=n=5")));
    }

    /// Vérifie que les clips fondent depuis et vers les espaces noirs de la timeline.
    #[test]
    fn fade_through_black_applies_around_timeline_gaps() {
        let mut filters = Vec::new();
        build_timed_background_chain(
            &mut filters,
            &["first".to_string(), "second".to_string()],
            &[2.0, 1.0],
            &[1.0, 5.0],
            1920,
            1080,
            30,
            8.0,
            VideoClipTransitionMode::FadeThroughBlack,
            1.0,
        );

        assert!(filters.iter().any(|line| {
            line == "[first]fade=t=in:st=0:d=1.000000,fade=t=out:st=1.000000:d=1.000000[bgfade0]"
        }));
        assert!(filters.iter().any(|line| {
            line == "[second]fade=t=in:st=0:d=0.500000,fade=t=out:st=0.500000:d=0.500000[bgfade1]"
        }));
    }

    /// Vérifie que le fondu croisé conserve la règle historique de chevauchement.
    #[test]
    fn crossfade_duration_matches_the_existing_overlap_rule() {
        let mut filters = Vec::new();
        build_timed_background_chain(
            &mut filters,
            &["first".to_string(), "second".to_string()],
            &[4.0, 3.0],
            &[0.0, 4.0],
            1920,
            1080,
            30,
            8.0,
            VideoClipTransitionMode::Crossfade,
            1.0,
        );

        assert!(filters
            .iter()
            .any(|line| line.contains("xfade=transition=fade:duration=1.000000:offset=3.000000")));
        assert!(filters.iter().any(|line| line.contains("d=2.000000")));
    }

    /// Vérifie que chaque chevauchement explicite produit sa propre durée de crossfade.
    #[test]
    fn crossfade_duration_follows_each_timeline_overlap() {
        let mut filters = Vec::new();
        build_timed_background_chain(
            &mut filters,
            &[
                "first".to_string(),
                "second".to_string(),
                "third".to_string(),
            ],
            &[4.0, 3.0, 2.0],
            &[0.0, 2.0, 4.0],
            1920,
            1080,
            30,
            6.0,
            VideoClipTransitionMode::Crossfade,
            1.0,
        );

        assert!(filters
            .iter()
            .any(|line| line.contains("xfade=transition=fade:duration=2.000000:offset=2.000000")));
        assert!(filters
            .iter()
            .any(|line| line.contains("xfade=transition=fade:duration=1.000000:offset=4.000000")));
    }

    /// Vérifie qu'un clip isolé après des crossfades reste dans la timeline finale.
    #[test]
    fn preserves_a_detached_clip_after_timeline_crossfades() {
        let mut filters = Vec::new();
        build_timed_background_chain(
            &mut filters,
            &[
                "first".to_string(),
                "second".to_string(),
                "third".to_string(),
                "detached".to_string(),
            ],
            &[5.042, 5.042, 5.042, 5.567],
            &[0.0, 2.612, 6.421, 11.836],
            1080,
            1920,
            30,
            19.077,
            VideoClipTransitionMode::Crossfade,
            1.2,
        );

        assert!(filters.iter().any(|line| line.contains("concat=n=4")));
        assert!(filters.iter().any(|line| {
            line.starts_with("[detached]trim=start=0:end=5.567000,setpts=PTS-STARTPTS")
        }));
    }
}

// ---------------------------------------------------------------------------
// Commande Tauri : cancel_export
