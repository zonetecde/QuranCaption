"""Pipeline progress bar — CSS-animated fill with elapsed counter."""

import random


def pipeline_progress_bar_html(estimated_duration_s):
    """Return HTML for a continuous progress bar timed to *estimated_duration_s*.

    The container ``<div>`` carries a ``data-ppb-duration`` attribute that a
    MutationObserver in the page head reads to start a 0.1 s elapsed-time
    counter (``Xs / Ys``).
    """
    uid = f"ppb{random.randint(0, 999999)}"
    duration = max(estimated_duration_s, 5)

    return f'''<div id="{uid}" data-ppb-duration="{duration}" style="
        position:relative; width:100%; height:40px;
        background:#e5e7eb; border-radius:8px; overflow:hidden;
        font-family:system-ui,sans-serif; font-size:14px;
    ">
        <div id="{uid}-fill" style="
            position:absolute; top:0; left:0; height:100%;
            width:0%; background:linear-gradient(90deg,#3b82f6,#2563eb);
            border-radius:8px;
            animation:{uid}-grow {duration}s linear forwards;
        "></div>
        <span id="{uid}-text" style="
            position:absolute; inset:0; display:flex;
            align-items:center; justify-content:center;
            color:#1f2937; font-weight:600; z-index:1;
            text-shadow:0 0 4px rgba(255,255,255,0.8);
        ">0s / {duration}s</span>
        <style>
            @keyframes {uid}-grow {{
                from {{ width:0%; }}
                to   {{ width:100%; }}
            }}
        </style>
    </div>'''
