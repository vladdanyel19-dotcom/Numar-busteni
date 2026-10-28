# Numără Bușteni

Aplicație web (PWA) care numără bușteni dintr-o poză. Rulează pe telefon, fără internet.

- `index.html`, `app.js`, `style.css` — aplicația
- `detector.js` + `model.json` — detectorul automat (rulează local pe telefon)
- `training/` — codul cu care se antrenează `model.json` din pozele marcate de utilizator

Reantrenare: `python3 training/train_final.py date.json model.json` (vezi comentariile din fișier).
Pozele și marcajele de antrenare NU sunt în depozit.
