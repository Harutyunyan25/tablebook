# TableBook

Restaurant-Reservierungs-App (Oberfläche auf Armenisch) für das Ristorante «Արարատ» – im klassischen Schwarz-Gold-Design.

## Funktionen

- Registrierung und Login (Passwörter werden mit SHA-256 + Salt gehasht)
- Tisch reservieren: Datum, Uhrzeit, Personenzahl, Bereich (Saal, Fenster, Terrasse)
- Interaktiver Tischplan mit freien, belegten und ausgewählten Tischen (Schutz vor Doppelbuchungen, 2 Std. pro Reservierung)
- „Meine Reservierungen“ mit Stornieren
- Aktionen: Kinderportionen, Geburtstag, Business-Lunch, Weinstunde
- Geschenkkarten

## Starten

`index.html` im Browser öffnen – fertig.

Optional über einen lokalen Server (ohne Node/Python):

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Dann http://localhost:3000 öffnen.

Demo-Zugang: `demo@tablebook.am` / `demo1234`

> Hinweis: Alle Daten (Konten, Reservierungen) werden im `localStorage` des Browsers gespeichert. Fotos stammen von Unsplash, Schriften von Google Fonts.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur |
| `style.css` | Schwarz-Gold-Design |
| `app.js` | Login, Reservierungslogik, Tischplan, Aktionen |
| `serve.ps1` | Kleiner lokaler Webserver in PowerShell |
