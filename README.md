<div align="center">

# 🎮 Modey Server CLI

**L'outil en ligne de commande officiel pour initialiser, configurer et connecter un serveur Minecraft au réseau décentralisé Modey.**

[![GitHub Release](https://img.shields.io/github/v/release/Modey-NewWorld/modey-server-cli?color=6366f1&style=flat-square)](https://github.com/Modey-NewWorld/modey-server-cli/releases)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue?style=flat-square)](LICENSE)

</div>

---

## 🌟 Présentation

`@modey/server-cli` est l'agent léger autonome conçu pour les administrateurs et hébergeurs de serveurs Minecraft. Il permet de :

1. **Générer en quelques secondes le manifeste `modey-server.json`** décrivant l'identité de votre serveur, sa politique d'accès et ses options d'affichage dans le Launcher Modey.
2. **Installer automatiquement votre chargeur de mods ou serveur de jeu** (*NeoForge*, *Fabric*, *PaperMC*, *Forge*, *Vanilla*) — aucun `.jar` à chercher manuellement.
3. **Héberger votre propre Files-Updater** (`client-files/`) directement sur votre machine pour distribuer vos mods requis/optionnels au Launcher Modey, même sans Docker.
4. **Connecter votre serveur au réseau Modey (optionnel)** via des battements de cœur périodiques (**Heartbeats** toutes les 30s), ou fonctionner **100 % en local / privé** (`--standalone`).
5. **Zéro dépendance externe** : Conçu en Node.js pur (Node 18+), il génère des scripts `start.bat` (Windows) et `start.sh` (Linux) prêts à l'emploi.

---

## 🚀 Installation & Démarrage Rapide (Sans Docker)

### Prérequis
- **Node.js 18.0.0 ou supérieur** (`node -v`)
- **Java 21 ou supérieur** (`java -version`) pour exécuter Minecraft 1.20.5+

### Option A — Installation guidée en 1 commande (Recommandé, sans installation)
Placez-vous dans un dossier vide et exécutez simplement :

```bash
npx github:Modey-NewWorld/modey-server-cli
```
*(Ou `npx github:Modey-NewWorld/modey-server-cli install` — si `modey-server.json` n'existe pas encore, l'assistant Modey vous pose automatiquement les questions de version, loader, RAM et mode réseau avant de tout télécharger).*

L'assistant s'occupe ensuite de tout automatiquement :
1. Choix du nom, version Minecraft et type de serveur (**NeoForge**, **Fabric**, **PaperMC** ou **Vanilla**) + RAM.
2. Téléchargement du serveur officiel / installeur et installation de **`authlib-injector.jar`** (authentification Modey Yggdrasil SSO prête par défaut).
3. Création de `eula.txt`, `server.properties`, `client-files/`, `start.bat` et `start.sh`.

### Relier un serveur au réseau Modey (validation propriétaire)
Lorsque l'équipe Modey crée ou valide une fiche serveur pour votre infrastructure, il suffit d'exécuter une fois dans le dossier du serveur :

```bash
npx github:Modey-NewWorld/modey-server-cli link <votre_node_token>
```

### Option B — Installation globale (`modey-server`)

```bash
npm install -g git+https://github.com/Modey-NewWorld/modey-server-cli.git
modey-server init
modey-server install
```

### Lancer avec `start.bat` (Windows) ou `start.sh` (Linux / macOS)
Après `init` ou `install`, deux scripts sont automatiquement générés à la racine de votre serveur :
- **Windows** : double-cliquez sur `start.bat` (ou lancez `.\start.bat` dans un terminal).
- **Linux / macOS** : rendez exécutable une fois (`chmod +x start.sh`) puis lancez `./start.sh`.

> Aucun Docker requis : les scripts lancent le serveur Minecraft (`java`) ainsi que le serveur HTTP **Files-Updater** (`client-files/`).

---

## 📖 Commandes Disponibles

| Commande | Description |
| :--- | :--- |
| `modey-server init` | Lance l'assistant de configuration interactif (`--non-interactive` supporté). |
| `modey-server install` | Crée `/mods`, `/config`, `/client-files`, installe `authlib-injector.jar`, accepte `eula.txt`, télécharge/installe le loader et crée `start.bat`/`start.sh`. |
| `modey-server link <token>` | Confirme la liaison du serveur avec votre fiche Modey pour activer la visibilité et la télémétrie. |
| `modey-server update` | Met à jour le CLI, `authlib-injector.jar` et les scripts `start.bat`/`start.sh`. |
| `modey-server sync` | Envoie le contenu de `modey-server.json` vers l'API centrale Modey (optionnel). |
| `modey-server run` | Démarre le serveur Minecraft (`java`), le Files-Updater HTTP et la télémétrie (si configurée). |
| `modey-server run --daemon-only` | Exécute uniquement la télémétrie et le Files-Updater si le serveur tourne déjà sous **systemd**, **Docker** ou **Pterodactyl**. |
| `modey-server updater` | Démarre uniquement le serveur HTTP Files-Updater (`client-files/`). |
| `modey-server status` | Interroge l'API centrale pour afficher l'état en direct du serveur et ses badges. |
| `modey-server --help` | Affiche l'aide détaillée et les options disponibles. |

---

## ⚙️ Exemple de fichier `modey-server.json`

Le fichier généré à la racine de votre serveur ressemble à ceci :

```json
{
  "schema_version": "1.0",
  "identity": {
    "name": "Modey Survie RP",
    "slug": "survie-rp",
    "minecraft_version": "1.21.1",
    "loader": "neoforge",
    "loader_version": "21.1.265",
    "motd": "Bienvenue sur Survie RP (Modey Network)"
  },
  "network": {
    "public_ip": "play.monserveur.fr",
    "port": 25565
  },
  "auth": {
    "standalone": false,
    "api_url": "https://api.modey.flowcrea.fr",
    "node_token": "nd_sec_7a8b9c..."
  },
  "launcherOptions": {
    "status": "online",
    "description": "Serveur Survie RP propulsé par la communauté Modey.",
    "tags": ["Survie", "Roleplay", "Économie"],
    "account_policy": "modey",
    "enforce_hash_integrity": true,
    "access_mode": "normal"
  },
  "runtime": {
    "java_args": ["-Xms2G", "-Xmx4G"],
    "server_jar": "server.jar"
  }
}
```

---

## 🔒 Sécurité & Launch Guard

Lorsque `enforce_hash_integrity` est activé sur un serveur protégé ou officiel, le CLI et le mod serveur valident chaque connexion de joueur auprès de l'endpoint central `/api/nodes/verify-session`. Les tentatives de connexion avec des clients altérés ou des profils locaux non certifiés sont ainsi rejetées automatiquement.

---

## 📄 Licence

Ce projet est distribué sous la licence **PolyForm Noncommercial 1.0.0**. Consultez le fichier [LICENSE](LICENSE) pour plus d'informations.

---

<div align="center">

**FlowCreativeStudio** · Florian ([@NayrolfRdgs](https://github.com/NayrolfRdgs))

</div>
