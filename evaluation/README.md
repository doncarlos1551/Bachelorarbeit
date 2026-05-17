# Evaluation

Begleit-Material zur Bachelorarbeit.Anonymisierte Daten, Tabellen, Plots und Auswertungs-Notebook der Trust-Studie.

## Struktur

- [data/](data/): sieben anonymisierte CSVs mit [CODEBOOK.md](data/CODEBOOK.md)
- [tables/](tables/): vier Aggregat-Tabellen
- [figures/](figures/): 16 Plot-PDFs
- [notebook/](notebook/): Reproduktions-Notebook mit Helpers

## Datenschutz

Die Studie pseudonym erhoben (drei-Buchstaben-Codes je Person, nach DSGVO Art. 4 Nr. 5 personenbezogen). Public-Bundle enthält nur Daten, die für die Auswertung notwendig sind (Art. 5 Abs. 1 lit. c, Datenminimierung). Volle Begründung im Methodik-Kapitel der Thesis ([thesis/chapters/03-methodik.tex](../thesis/chapters/03-methodik.tex)).

### Vorgehen

1. **Mapping**: `prod_xxx` -> `Pnn` (P01 bis P18), sortier nach Sitzungs-Start. Mapping-Tabelle bleibt lokal.
2. **Felder reduzieren**: technische IDs (`session_id`, `responseId`, `caseRunId`) entfernt, Plan-IDs zu `Pnn_PLNnn` umnummeriert.
3. **Frei-Text entfernen**: Volltext-Notes, Volltext-Feedback und Chat-Verläufe raus. Nur Längen-Indikatoren (`has_notes`, `notes_chars`) bleiben.
4. **Schreiben**: Ergebnis in [data/](data/), [tables/](tables/) und [figures/](figures/).

### Felder

| Kategorie         | Bleibt                                                                                                           | Entfernt oder transformiert                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Identifikation    | `pid` als `Pnn`                                                                                                  | `prod_xxx`, `session_id`, `responseId`, `caseRunId` |
| Gruppe und Design | `group`, `design`, `variant`                                                                                     | --                                                  |
| Case-Setup        | `case`, `case_gt_decision`, `case_risk_class`                                                                    | --                                                  |
| Outcome           | `decision`, `correct_vs_gt`, `task_succeeded_self`, `tech_succeeded`                                             | --                                                  |
| Likert-Items      | `trust_rating`, `confidence_rating`, `transparency_rating`, `control_rating`                                     | --                                                  |
| Verhalten         | `decision_time_s`, `plans_seen`, `plans_approved`, `plans_rejected`, `chat_n_user_msgs`, `chat_n_assistant_msgs` | --                                                  |
| Frei-Text         | `has_notes`, `notes_chars`                                                                                       | Volltext-Notes, Volltext-Feedback, Chat-Verlauf     |
| SUS               | `sus_q01` bis `sus_q10`, `sus_score`                                                                             | --                                                  |
| Plans             | `Pnn_PLNnn`, Aggregat-Felder                                                                                     | Original-Plan-ID, Session-Referenz                  |

### Beispiel

Fiktive Person `prod_xyz`. Werte erfunden, kein realer Teilnehmer.

Vor der Anonymisierung:

```text
pid       session_id              group             design  case  variant  decision  trust  notes                                       has_notes  notes_chars
prod_xyz  sess_mo7abc12_a1b2c3d4  professional_dev  A       C04   summary  approve   5      "überzeugte mich nicht, aber okay gemacht"  1          43
```

Nach der Anonymisierung:

```text
pid  group             design  case  variant  decision  trust  has_notes  notes_chars
PXX  professional_dev  A       C04   summary  approve   5      1          43
```

`prod_xyz` -> `PXX`, `session_id` entfernt, Volltext-`notes` entfernt, Länge bleibt als `notes_chars`.

### Nicht im Repo

- Volltext-Notes, Volltext-Feedback, Chat-Verläufe
- Original-Pseudonyme `prod_xxx`, Mapping-Tabelle
- Original-Session-IDs und API-Identifier
- Anonymisierungs-Skript (auf Anfrage verfügbar)

Eine bedachte Auswahl an Frei-Text-Stellen erscheint im Anhang der Thesis mit `Pnn`-Bezug, ausschließlich in moderierter Form.

## Reproduktion

- [tables/](tables/) aus [data/](data/) via [notebook/analysis.ipynb](notebook/analysis.ipynb) (Restart + Run All)
- Schritt von Roh-Daten zu [data/](data/) ist nicht öffentlich reproduzierbar, weil die Roh-Daten nicht öffentlich geteilt werden
