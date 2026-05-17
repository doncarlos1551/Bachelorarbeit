# Codebook

Beschreibung der Felder pro CSV.

## Allgemein

- `pid`: Pseudonym P01 bis P18
- `group`: `citizen_dev` oder `professional_dev`
- `design`: Counterbalance A, B oder C, siehe `counterbalance-designs.csv`

## analysis-long.csv

Eine Zeile pro Case-Run, 144 Zeilen.

- `case`: C01 bis C08
- `case_gt_decision`: Ground Truth, `approve` oder `reject`
- `case_risk_class`: `low`, `medium`, `high`
- `variant`: `summary`, `diff`, `diff_risk`
- `used_standard_prompt`: 1 wenn Beispiel-Prompt unverändert übernommen
- `decision`: `approve` oder `reject`
- `correct_vs_gt`: 1 wenn `decision` gleich `case_gt_decision`
- `task_succeeded_self`: Selbst-Einschätzung, 0 oder 1
- `tech_succeeded`: technisch verifiziert, 0 oder 1
- `trust_rating`, `confidence_rating`, `transparency_rating`, `control_rating`: Likert 1 bis 7
- `decision_time_s`: Sekunden bis Approval-Entscheidung
- `plans_seen`, `plans_approved`, `plans_rejected`: Plan-Counts im Case-Run
- `chat_n_user_msgs`, `chat_n_assistant_msgs`: Chat-Aktivität
- `has_notes`: 1 wenn Frei-Text-Notes vorhanden
- `notes_chars`: Zeichenlänge der Notes, 0 wenn keine
- `overestimated`: 1 wenn `task_succeeded_self=1` und `tech_succeeded=0`
- `underestimated`: 1 wenn `tech_succeeded=1` und `task_succeeded_self=0`

## analysis-wide.csv

Eine Zeile pro Teilnehmer, 18 Zeilen.

- `sus_score`: 0 bis 100, Brooke 1996
- `overall_trust`: 1 bis 7, Post-Session
- `would_use`: `yes`, `maybe`, `no`
- Pro Case `Cnn_*`: Variante, vier Likert-Items, Decision-Time, Tech- und Self-Erfolg, Korrektheit

## sus-items.csv

Eine Zeile pro Teilnehmer, 18 Zeilen.

- `sus_q01` bis `sus_q10`: Roh-Antworten 1 bis 5
- `sus_score`: 0 bis 100, Scoring nach Brooke 1996 (ungerade Items minus 1, gerade Items 5 minus Wert, Summe mal 2.5)

## post-feedback.csv

Eine Zeile pro Teilnehmer. Kein Frei-Texte der Teilnemer im Public-Repo (Datenschutz).

- `overall_trust`: 1 bis 7
- `would_use`: `yes`, `maybe`, `no`

## plans-long.csv

Eine Zeile pro Plan im Sitzungs-Verlauf.

- `planId`: `Pnn_PLNnn`, fortlaufend pro Person
- `createdAt`: ISO-Zeitstempel
- `status`: `applied`, `pending`, `rejected`, `cancelled`
- `decision`: `approved`, `rejected`, `auto_approved`
- `mcpCall`: MCP-Tool-Name
- `op_count`: Anzahl Operationen
- `op_kinds`: kommagetrennte Operations-Kinds
- `risk_level`, `risk_score`, `risk_tags`: Output des Risk-Gates
- `requires_approval`: 1 wenn über Approval-Schwelle
- `gates_blocked`, `gates_evaluated`: kommagetrennte Gate-Listen
- `has_external_endpoint`: 1 wenn externe URL betroffen

## cases-metadata.csv

Eine Zeile pro Case.

- `case_id`: C01 bis C08
- `gt`: Ground-Truth-Entscheidung
- `risk_class`: erwartete Risiko-Klasse
- `task_short`: Kurzbeschreibung der Aufgabe

## counterbalance-designs.csv

Eine Zeile pro Design und Case.

- `design`: A, B oder C
- `case_id`: C01 bis C08
- `variant`: `summary`, `diff` oder `diff_risk`

## Risk-Tags

Werte im Feld `risk_tags` (plans-long.csv). Mehrere Tags durch `;` getrennt.

- `R_REFERENCE`: Operation ändert oder löscht referenzierte Komponenten
- `R_BULK_CHANGE`: Plan operiert auf vielen Operationen gleichzeitig (Threshold)
- `R_SCRIPT`: Plan enthält JavaScript-Code
- `R_CONTENT_SUSPICIOUS`: Content matcht verdächtige Pattern (z.B. `fetch` + externe URL)
- `R_ACTION`: Plan setzt onClick- oder Component-Action
- `R_DELETE`: Operation löscht eine Komponente
- `R_CASCADE_IMPACT`: Plan-Wirkung erstreckt sich auf abhängige Komponenten
- `R_EXTERNAL_IO`: Plan macht I/O zu externer URL (im Datensatz nur einmal aktiv)
