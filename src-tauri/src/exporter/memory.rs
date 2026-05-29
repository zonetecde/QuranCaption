use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use sysinfo::System;

use super::constants;
use super::types::{MemoryMonitorConfig, MemoryMonitorState};

/// Retourne le pourcentage de RAM système actuellement utilisée.
pub fn current_system_memory_used_percent(system: &mut System) -> Option<f64> {
    system.refresh_memory();
    let total = system.total_memory();
    if total == 0 {
        return None;
    }

    Some(system.used_memory() as f64 / total as f64 * 100.0)
}

/// Lance un thread watcher qui tue le processus FFmpeg si la RAM dépasse
/// `config.max_used_percent`.
///
/// Le watcher scrute la RAM toutes les `MEMORY_MONITOR_INTERVAL_MS` millisecondes.
/// Quand le seuil est dépassé, il marque l'état `exceeded` et envoie un kill.
pub fn spawn_memory_monitor(
    process_ref: Arc<Mutex<Option<std::process::Child>>>,
    config: MemoryMonitorConfig,
    state: Arc<Mutex<MemoryMonitorState>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut system = System::new();

        loop {
            thread::sleep(Duration::from_millis(constants::MEMORY_MONITOR_INTERVAL_MS));

            // Vérifier si le processus est déjà terminé (sortie normale)
            let process_finished = process_ref
                .lock()
                .map(|mut process_guard| {
                    process_guard
                        .as_mut()
                        .map(|child| matches!(child.try_wait(), Ok(Some(_))))
                        .unwrap_or(true)
                })
                .unwrap_or(true);
            if process_finished {
                break;
            }

            let Some(used_percent) = current_system_memory_used_percent(&mut system) else {
                continue;
            };

            // Mise à jour du pic de RAM observé
            if let Ok(mut state_guard) = state.lock() {
                state_guard.peak_percent = state_guard.peak_percent.max(used_percent);
            }

            // Sous le seuil : on continue
            if used_percent < config.max_used_percent {
                if process_ref
                    .lock()
                    .map(|process_guard| process_guard.is_none())
                    .unwrap_or(true)
                {
                    break;
                }
                continue;
            }

            // Dépassement du seuil : kill FFmpeg
            if let Ok(mut state_guard) = state.lock() {
                state_guard.exceeded = true;
            }

            if let Ok(mut process_guard) = process_ref.lock() {
                if let Some(child) = process_guard.as_mut() {
                    println!(
                        "[memory][auto-batch] RAM {:.1}% >= {:.1}%, stopping ffmpeg for retry",
                        used_percent, config.max_used_percent
                    );
                    let _ = child.kill();
                } else {
                    break;
                }
            }

            break;
        }
    })
}
