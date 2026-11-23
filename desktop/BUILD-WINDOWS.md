# Compiler OpenFS en vrai logiciel Windows (.exe)

Ce dossier `desktop/` empaquette l'interface **OpenFS** dans une application bureau **Electron** 100 % autonome (hors-ligne, sans navigateur, sans connexion Google) équipée d'un pont natif **Windows WPD (MTP/PTP)** qui lit directement `Ce PC -> Apple iPhone` sans les limites de Chrome/Edge.

## Option 1 — Compiler directement sur votre PC Windows

Prérequis : [Node.js 20+](https://nodejs.org/) installé sur Windows.

```powershell
# 1. À la racine du projet : installer les dépendances de l'interface React
npm install

# 2. Dans le dossier desktop : installer Electron et générer le .exe
cd desktop
npm install
npm run build:win
```

Les fichiers générés apparaîtront dans `desktop/release/` :
- **`OpenFS-Setup-1.0.0.exe`** : véritable installeur Windows (Assistant d'installation, icône Bureau, Menu Démarrer, Désinstallateur Windows).
- **`OpenFS-Portable-1.0.0.exe`** : version exécutable directe sans installation.

## Option 2 — Compiler gratuitement dans le cloud (GitHub Actions)

1. Envoyez ce projet sur un dépôt GitHub.
2. Ouvrez l'onglet **Actions → Build OpenFS Windows Installer (.exe)**.
3. Cliquez sur **Run workflow**.
4. Au bout de ~2 minutes, téléchargez l'artefact **`OpenFS-Windows-Installers`** contenant `OpenFS-Setup-1.0.0.exe`.
