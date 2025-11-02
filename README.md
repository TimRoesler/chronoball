# Chronoball 🏀

![GitHub release (latest by date)](https://img.shields.io/github/v/release/TimRoesler/chronoball?style=for-the-badge)
![Foundry VTT Compatibility](https://img.shields.io/badge/Foundry%20VTT-v12-orange?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

> Chronoball is a dynamic Foundry VTT minigame module for turn-based ball competitions. Featuring two teams, strategic phases, comprehensive scoring, and an intuitive HUD, it brings exciting grid-based sports action to your virtual tabletop.

---

## 🌟 Features

- **Team Management:** Easily create and manage two competing teams.
- **Turn-Based Gameplay:** Structured in turns for strategic decisions.
- **Player Actions:** Move, carry the ball, and throw it to your teammates.
- **Scoring System:** Score points by getting the "Chronoball" into the opponent's endzone.
- **Interactive HUD:** A clean heads-up display provides real-time game state information.
- **Customizable Rules:** Configure grid size, movement points, and more.
- **Visual Effects:** Optional integration with "Sequencer" for throw animations.

---

## 🚀 Installation

1.  In Foundry VTT, go to the **Add-on Modules** tab.
2.  Click **Install Module**.
3.  Paste the following URL into the **Manifest URL** field:
    ```
    https://github.com/TimRoesler/chronoball/releases/latest/download/module.json
    ```
4.  Click **Install** and enable the **Chronoball** module in your world.

---

## 🎮 How to Play

1.  As GM, open the **Chronoball Player Panel** from the scene controls.
2.  Use the **Roster** tab to assign tokens to **Team A** and **Team B**.
3.  Use the **Rules Panel** to configure the game settings.
4.  Start the game! Players use the Player Panel to perform actions on their turn.

---

## 🧑‍💻 Author

- **TimRoesler**
- **DISCLAIMER: This module was created with the assistance of Claude, an AI developed by Anthropic.**

### 1. Einrichtung des Moduls

1.  **Installation:**
    *   Gehe im Foundry VTT Hauptmenü zum Reiter **"Add-on Modules"**.
    *   Klicke auf **"Install Module"**.
    *   Füge die folgende URL in das Feld **"Manifest URL"** ein:
        ```
        https://github.com/TimRoesler/chronoball/releases/latest/download/module.json
        ```
    *   Klicke auf **"Install"** und warte, bis die Installation abgeschlossen ist.

2.  **Aktivierung und Konfiguration:**
    *   Starte deine Spielwelt und aktiviere dort das Modul **"Chronoball"**.
    *   Gehe als Spielleiter (GM) in die Modul-Einstellungen (`Configure Settings` -> `Module Settings`).
    *   Suche den Abschnitt für "Chronoball". Dort findest du zwei wichtige Knöpfe:
        *   **Open Rules Panel:** Öffnet das Panel zur Konfiguration der Spielregeln.
        *   **Open Player Panel:** Öffnet das Panel zur Verwaltung der Teams und des Spiels.

3.  **Spiel vorbereiten:**
    *   **Endzonen festlegen:** Öffne das **Rules Panel**. Du musst hier die IDs der Kacheln (Tiles) festlegen, die als Endzonen für Team A und Team B dienen sollen. Wähle eine Kachel auf deiner Szene aus und kopiere ihre Tile-ID in das entsprechende Feld.
    *   **Teams zuweisen:** Platziere die Tokens der teilnehmenden Spieler in ihre jeweilige Start-Endzone auf der Karte. Öffne das **Player Panel** und klicke auf **"Determine Teams from Endzones"**. Das Modul weist die Spieler automatisch den Teams zu.

### 2. Spielablauf

1.  **Match starten:** Wenn die Teams konfiguriert sind, klicke im **Player Panel** auf **"Start Match"**. Das Modul erstellt automatisch einen Eintrag im Kampf-Tracker (Combat Tracker) und legt die Zugreihenfolge fest, wobei die Teams abwechselnd am Zug sind.

2.  **Rundenbasierte Aktionen:** Das Spiel verläuft in Runden, genau wie ein normaler Kampf in Foundry. Der Spieler, der am Zug ist, wird im Kampf-Tracker hervorgehoben.

3.  **Punkte erzielen:** Das Ziel ist es, mehr Punkte als das gegnerische Team zu erzielen. Punkte gibt es, wenn:
    *   Ein Spieler mit dem Ball in die gegnerische Endzone läuft.
    *   Der Ball erfolgreich in die gegnerische Endzone geworfen wird.
    *   Ein Pass zu einem Mitspieler, der sich in der Endzone befindet, erfolgreich ist.

### 3. Verwendung der Makros

Das Modul erstellt automatisch vier Makros in deinem Makro-Verzeichnis. Für die meisten Aktionen musst du zuerst den Token deines Charakters auf der Karte auswählen.

*   **`Chronoball: Ball werfen`**
    *   **Aktion:** Wirft den Ball zu einer beliebigen Position auf dem Spielfeld.
    *   **Anwendung:** Wähle deinen Token aus (du musst der Ballträger sein) und klicke das Makro. Klicke danach auf die gewünschte Zielposition auf der Karte. Für den Wurf ist eine Probe (Skill Check) erforderlich.

*   **`Chronoball: Pass`**
    *   **Aktion:** Passt den Ball zu einem anderen Token.
    *   **Anwendung:** Wähle deinen Token aus (du musst der Ballträger sein), nimm einen anderen Token ins Ziel (target) und klicke dann auf das Makro. Auch hier ist eine Probe erforderlich.

*   **`Chronoball: Ball aufnehmen`**
    *   **Aktion:** Nimmt den auf dem Boden liegenden Ball auf.
    *   **Anwendung:** Bewege deinen Token so, dass er sich direkt neben dem Ball-Token befindet. Wähle deinen Token aus und klicke das Makro.

*   **`Chronoball: Ball fallen lassen`**
    *   **Aktion:** Lässt den Ball an deiner aktuellen Position fallen.
    *   **Anwendung:** Wenn du der Ballträger bist, wähle deinen Token aus und klicke das Makro. Der Ball erscheint als eigener Token auf dem Feld.
