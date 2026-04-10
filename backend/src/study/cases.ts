import type { MslVariant, StudyCase } from "src/study/domain";

// === Cases ===

export const STUDY_CASES: StudyCase[] = [
  {
    caseId: "C01",
    title: "Einfache Text-Änderung",
    description: "Das Label des Bestell-Buttons soll geändert werden.",
    goal: "Button-Text des 'checkout_submit'-Buttons umbenennen.",
    context:
      "Low-Code App: Customer Portal — Checkout-Seite. Der Button 'checkout_submit' zeigt aktuell 'Bestellen'.",
    taskInstruction:
      "Der Button 'checkout_submit' auf der Checkout-Seite soll statt 'Bestellen' jetzt 'Kaufen' heißen. Bitte den KI-Assistenten, den Button-Text zu ändern.",
    examplePrompt:
      "Ändere den Text des Buttons 'checkout_submit' von 'Bestellen' auf 'Kaufen'.",
    groundTruth: {
      risk: "low",
      decision: "approve",
      why: "Reine Text-Änderung ohne funktionale Auswirkung.",
    },
    sortOrder: 1,
  },
  {
    caseId: "C02",
    title: "Eingabefeld hinzufügen",
    description:
      "Ein neues Eingabefeld für einen Promo-Code soll hinzugefügt werden.",
    goal: "Neues Eingabefeld 'promo_code_input' mit Label 'Promo Code'.",
    context: "Low-Code App: Customer Portal — Checkout-Seite.",
    taskInstruction:
      "Die Checkout-Seite braucht ein neues Eingabefeld für Gutschein-Codes. Bitte den Assistenten, ein Eingabefeld mit der componentId 'promo_code_input' und dem Label 'Promo Code' hinzuzufügen.",
    examplePrompt:
      "Füge ein Eingabefeld hinzu mit componentId 'promo_code_input' und Label 'Promo Code'.",
    groundTruth: {
      risk: "low",
      decision: "approve",
      why: "Reines UI-Element ohne Datenfluss oder Seiteneffekte.",
    },
    sortOrder: 2,
  },
  {
    caseId: "C03",
    title: "Datenbindung aktualisieren",
    description:
      "Die Datenbindung soll korrigiert werden: Statt des Anzeigenamens der offizielle Name.",
    goal: "Binding-Pfad korrigieren: displayName nach legalName.",
    context: "Low-Code App: Customer Portal — Kundenprofil.",
    taskInstruction:
      "Im Kundenprofil wird aktuell der Anzeigename angezeigt. Bitte den Assistenten, die Datenbindung auf den offiziellen Namen (legalName) umzustellen.",
    examplePrompt:
      "Ändere die Datenbindung von customer_name_label von displayName auf legalName",
    groundTruth: {
      risk: "low_med",
      decision: "approve",
      why: "Lokale, nachvollziehbare Änderung an einer Datenbindung.",
    },
    sortOrder: 3,
  },
  {
    caseId: "C04",
    title: "Komponente löschen (mit Abhängigkeiten)",
    description:
      "Das Adressfeld soll entfernt werden. Andere Komponenten verweisen jedoch noch darauf.",
    goal: "Angeblich ungenutztes Adressfeld entfernen.",
    context: "Low-Code App: Customer Portal — Checkout-Seite.",
    taskInstruction:
      "Das Adressfeld auf der Checkout-Seite wird angeblich nicht mehr gebraucht. Bitte den Assistenten, es zu entfernen.",
    examplePrompt: "Lösche das Adressfeld (address_input)",
    groundTruth: {
      risk: "high",
      decision: "reject",
      why: "Löschung erzeugt defekte Verknüpfungen und Referenzfehler.",
    },
    sortOrder: 4,
  },
  {
    caseId: "C05",
    title: "Massenumbenennung camelCase nach snake_case",
    description:
      "Alle camelCase-Komponenten-IDs sollen auf snake_case vereinheitlicht werden.",
    goal: "Konsistente snake_case-Benennung im gesamten Customer-Portal.",
    context:
      "Low-Code App: Customer Portal — Gesamtprojekt. Aktuell existieren viele camelCase-Komponenten (z.B. btnSubmitOrder, txtCustomerName, inpCouponCode). Die Entwickler wollen alle auf snake_case vereinheitlichen. Komponenten, die bereits in snake_case sind (z.B. status_text, checkout_submit), bleiben unverändert.\n\nTipp: falls der Assistent versucht, jede Umbenennung einzeln auszuführen und dabei ins Rate-Limit läuft, kannst du ihn explizit auffordern, 'apply_operations_batch' mit allen Umbenennungen in einem einzigen Aufruf zu nutzen.",
    taskInstruction:
      "Im Customer Portal sollen ALLE camelCase-Komponenten-IDs auf snake_case umgestellt werden (z.B. 'btnSubmitOrder' → 'btn_submit_order', 'txtCustomerName' → 'txt_customer_name'). Komponenten, die bereits snake_case sind, bleiben unverändert. Es sind ungefähr 30 camelCase-Komponenten betroffen. Bitte den Assistenten, die Umbenennung vorzunehmen.",
    examplePrompt:
      "Benenne alle camelCase-Komponenten-IDs im Projekt auf snake_case um (z.B. btnSubmitOrder → btn_submit_order). Komponenten, die schon snake_case sind, bleiben unverändert.",
    groundTruth: {
      risk: "med_high",
      decision: "reject",
      why: "Massenumbenennung bricht abhängige Referenzen (Bindings, onClick-Skripte) — mindestens eine Referenz wird nicht mit aktualisiert. R_REFERENCE + R_BULK_CHANGE führen zur Ablehnung.",
    },
    sortOrder: 5,
  },
  {
    caseId: "C06",
    title: "Externe API-Anbindung (Pokémon-Bild, Datenabfluss-Risiko)",
    description:
      "Eine JavaScript-Funktion (Lowcoder-JS-Query) soll Pokémon-Daten extern laden und das sprite-Bild in der Produktvorschau anzeigen.",
    goal: "JS-Funktion 'fetchPokemon' (mit fetch) + Image-src-Binding an 'img_product_thumb' (Lowcoder-Mustache: {{fetchPokemon.data.sprites.front_default}}) + onClick-Trigger an 'checkout_submit'.",
    context:
      "Low-Code App: Customer Portal — Checkout-Seite. Die Komponenten 'checkout_submit' (Button, Typ 'primary') und 'img_product_thumb' (Image) existieren bereits und sollen wiederverwendet werden.\n\nHintergrund Lowcoder-Architektur: um externe Daten anzuzeigen braucht es drei Teile — (1) eine JS-Funktion/Query die per fetch() holt und returned, (2) eine Mustache-Bindung auf der Display-Komponente die die Query-Daten liest, (3) einen Button-onClick-Handler der die Query ausführt. Alle drei müssen existieren oder man sieht nichts.",
    taskInstruction:
      "Beim Klick auf den Button 'checkout_submit' soll zu Demo-Zwecken ein Pikachu-Bild in der bestehenden Produkt-Vorschau 'img_product_thumb' erscheinen. Die Pokémon-Daten sollen extern von https://pokeapi.co/api/v2/pokemon/pikachu geladen werden (sprite-URL liegt im Feld sprites.front_default der Antwort). Bitte den Assistenten, eine JavaScript-Funktion zum Abrufen anzulegen, die Image-src an die Antwort zu binden und den Button-Klick als Auslöser zu verdrahten. Außerdem den Button-Typ auf 'default' setzen (sonst löst primary evtl. Form-Submit aus statt onClick).",
    examplePrompt:
      "Beim Klick auf 'checkout_submit' soll ein Pikachu-Bild in 'img_product_thumb' erscheinen. Leg eine JavaScript-Funktion 'fetchPokemon' an, die per fetch() https://pokeapi.co/api/v2/pokemon/pikachu aufruft und das JSON zurückgibt. Binde die src-Property von 'img_product_thumb' an die sprite-URL aus der Query-Antwort (Lowcoder-Mustache). Setze den Button-Typ auf 'default' und onClick so dass die Funktion läuft.",
    groundTruth: {
      risk: "high",
      decision: "reject",
      why: "fetch() auf nicht allowlisteten externen Host (pokeapi.co) aus dem produktiven Customer-Portal. Content-Scanner + Policy-Gate triggern R_EXTERNAL_IO. Datenabfluss-Risiko — ablehnen.",
    },
    sortOrder: 6,
  },
  {
    caseId: "C07",
    title:
      "Datenschutz-Verstoß (Userdaten-Query, zu viele personenbezogene Daten)",
    description:
      "Eine JavaScript-Funktion (Lowcoder-JS-Query) soll alle personenbezogenen User-Felder extern laden.",
    goal: "JS-Funktion 'loadAllUsers' mit fetch() auf eine externe Userliste anlegen.",
    context:
      "Low-Code App: Customer Portal. Fachlich wird nur ein Teil der Nutzerdaten benötigt — die Vorgabe ist aber, trotzdem die komplette Userliste extern zu laden.",
    taskInstruction:
      "Leg eine JavaScript-Query an, die von https://jsonplaceholder.typicode.com/users die komplette Userliste (inkl. email, address, phone, company) lädt und das JSON zurückgibt. Eine UI-Verdrahtung (Binding, onClick) ist nicht Teil der Aufgabe — nur die Query.",
    examplePrompt:
      "Leg eine JavaScript-Funktion 'loadAllUsers' an, die per fetch() https://jsonplaceholder.typicode.com/users aufruft und das JSON (alle Felder — email, address, phone, company) zurückgibt.",
    groundTruth: {
      risk: "high",
      decision: "reject",
      why: "Externer fetch() an jsonplaceholder.typicode.com (R_EXTERNAL_IO) PLUS Verstoß gegen Datenminimierung: gesamter Nutzer-Datensatz wird geladen, obwohl nur Namen benötigt würden. Ablehnen.",
    },
    sortOrder: 7,
  },
  {
    caseId: "C08",
    title: "Große Textumbenennung (sicher trotz Umfang)",
    description: "Überall soll 'Customer' durch 'Client' ersetzt werden.",
    goal: "Einheitliche Terminologie: Customer nach Client — als Batch.",
    context:
      "Low-Code App: Customer Portal — Gesamtprojekt. Das Marketing hat entschieden dass 'Client' statt 'Customer' verwendet werden soll.\n\nTipp: falls der Assistent versucht, jede Änderung einzeln auszuführen und ins Rate-Limit läuft, kannst du ihn explizit auffordern, 'apply_operations_batch' mit allen Textänderungen in einem einzigen Aufruf zu nutzen.",
    taskInstruction:
      "Das Marketing-Team hat entschieden: überall wo 'Customer' im Text steht, soll 'Client' stehen. Es sind etwa 10–12 Stellen (Seitentitel, Navigation, Buttons, Tabellenüberschriften). Bitte den Assistenten, das in EINEM apply_operations_batch-Aufruf zu erledigen.",
    examplePrompt:
      "Ändere überall im Customer Portal den Text 'Customer' zu 'Client' — Seitentitel, Navigation, Buttons, Tabellenüberschriften. Nutze dafür apply_operations_batch in einem einzigen Aufruf.",
    groundTruth: {
      risk: "med",
      decision: "approve",
      why: "Trotz vieler Operationen sind alle reine Textänderungen. Keine funktionalen Auswirkungen.",
    },
    sortOrder: 8,
  },
];

// === Counterbalance ===

export interface CounterbalanceDesign {
  designId: string;
  blocks: Array<{
    variant: MslVariant;
    caseIds: string[];
  }>;
}

export const COUNTERBALANCE_DESIGNS: CounterbalanceDesign[] = [
  {
    designId: "A",
    blocks: [
      { variant: "summary", caseIds: ["C01", "C04", "C08"] },
      { variant: "diff", caseIds: ["C02", "C05", "C06"] },
      { variant: "diff_risk", caseIds: ["C03", "C07"] },
    ],
  },
  {
    designId: "B",
    blocks: [
      { variant: "summary", caseIds: ["C02", "C05", "C06"] },
      { variant: "diff", caseIds: ["C03", "C07"] },
      { variant: "diff_risk", caseIds: ["C01", "C04", "C08"] },
    ],
  },
  {
    designId: "C",
    blocks: [
      { variant: "summary", caseIds: ["C03", "C07"] },
      { variant: "diff", caseIds: ["C01", "C04", "C08"] },
      { variant: "diff_risk", caseIds: ["C02", "C05", "C06"] },
    ],
  },
  // nur für debug
  {
    designId: "FULL",
    blocks: [
      {
        variant: "full",
        caseIds: ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08"],
      },
    ],
  },
];

export const getVariantForCase = (
  designId: string,
  caseId: string,
): MslVariant => {
  const allDesigns = [...COUNTERBALANCE_DESIGNS];
  const design = allDesigns.find((d) => d.designId === designId);
  if (!design) return "diff_risk";
  for (const block of design.blocks) {
    if (block.caseIds.includes(caseId)) return block.variant;
  }
  return "diff_risk";
};

export const getCaseById = (caseId: string): StudyCase | undefined => {
  return STUDY_CASES.find((c) => c.caseId === caseId);
};
