"""Helper-Funktionen für das Notebook.

Enthält Bootstrap-CIs, Effektgrößen-Berechnung und gemeinsame Plot-Defaults.
Daten-Eingang ist `../data/`, Plot-Ausgang `../figures/`.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from scipy import stats


DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
FIG_DIR = Path(__file__).resolve().parent.parent / 'figures'


def load_long() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'analysis-long.csv')


def load_wide() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'analysis-wide.csv')


def load_sus() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'sus-items.csv')


def load_post_feedback() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'post-feedback.csv')


def load_plans() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'plans-long.csv')


def load_cases() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'cases-metadata.csv')


def load_designs() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'counterbalance-designs.csv')


def bootstrap_mean_ci(values: Iterable[float], n_iter: int = 5000, alpha: float = 0.05, seed: int = 42) -> tuple[float, float, float]:
    """Bootstrap-CI für Mittelwert. Liefert (mean, lo, hi)."""
    rng = np.random.default_rng(seed)
    arr = np.asarray(list(values), dtype=float)
    arr = arr[~np.isnan(arr)]
    if len(arr) == 0:
        return (np.nan, np.nan, np.nan)
    samples = rng.choice(arr, size=(n_iter, len(arr)), replace=True)
    means = samples.mean(axis=1)
    lo = np.quantile(means, alpha / 2)
    hi = np.quantile(means, 1 - alpha / 2)
    return (float(arr.mean()), float(lo), float(hi))


def wilson_ci(successes: int, n: int, alpha: float = 0.05) -> tuple[float, float, float]:
    """Wilson-Score-Konfidenzintervall für eine Proportion. Liefert (p, lo, hi)."""
    if n == 0:
        return (np.nan, np.nan, np.nan)
    z = stats.norm.ppf(1 - alpha / 2)
    p = successes / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    lo = (centre - margin) / denom
    hi = (centre + margin) / denom
    return (p, max(0.0, lo), min(1.0, hi))


def effect_r(z: float, n: int) -> float:
    """Rosenthal-r-Effektgröße aus Wilcoxon-Z."""
    if n == 0:
        return np.nan
    return abs(z) / np.sqrt(n)


def save_plot(fig, name: str) -> None:
    """Speichert Figure als PDF in ../figures/."""
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIG_DIR / f'{name}.pdf', bbox_inches='tight')


VARIANT_ORDER = ['summary', 'diff', 'diff_risk']
VARIANT_COLOR = {'summary': 'peru', 'diff': 'steelblue', 'diff_risk': 'mediumseagreen'}
GROUP_COLOR = {'professional_dev': 'steelblue', 'citizen_dev': 'peru'}
ITEM_LABELS = {
    'trust_rating': 'Trust',
    'confidence_rating': 'Confidence',
    'transparency_rating': 'Transparency',
    'control_rating': 'Control',
}
