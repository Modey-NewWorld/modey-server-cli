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
2. **Installer automatiquement votre chargeur de mods ou serveur de jeu** (*NeoForge*, *Fabric*, *PaperMC*, *Forge*, *Vanilla*).
3. **Connecter votre serveur à la centrale Modey** via des battements de cœur périodiques (**Heartbeats** toutes les 30s) remontant l'état en ligne, les TPS, la mémoire RAM et les joueurs connectés.
4. **Synchroniser vos métadonnées** (bannières, description, tags, mode d'accès) directement avec l'Admin Panel et l'API centrale sans aucune manipulation manuelle en base de données.
5. **Zéro dépendance externe** : Conçu en Node.js pur (Node 18+), il fonctionne immédiatement sur n'importe quelle machine sans alourdir vos serveurs.

---

## 🚀 Installation & Démarrage Rapide

### Prérequis
- **Node.js 18.0.0 ou supérieur** (`node -v`)
- **Java 21 ou supérieur** pour exécuter Minecraft 1.20.5+

### Utilisation avec `npx` (Recommandé)
Vous n'avez même pas besoin d'installer le paquet localement. Placez-vous dans le dossier de votre serveur et lancez :

```bash
# 1. Assistant interactif pour générer modey-server.json
npx @modey/server-cli init

# 2. Téléchargement automatique du loader et acceptation de l'EULA
npx @modey/server-cli install

# 3. Démarrage du serveur avec surveillance et battements de cœur
npx @modey/server-cli run
```

---

## 📖 Commandes Disponibles

| Commande | Description |
| :--- | :--- |
| `modey-server init` | Lance l'assistant de configuration interactif (nom, slug, loader, port, token). |
| `modey-server install` | Prépare l'arborescence (`/mods`, `/config`), accepte `eula.txt` et télécharge le jar serveur. |
| `modey-server sync` | Envoie le contenu de `modey-server.json` vers la plateforme centrale Modey. |
| `modey-server run` | Démarre le serveur Minecraft (`java`) et le daemon de télémétrie en tâche de fond. |
| `modey-server run --daemon-only` | Exécute uniquement la télémétrie si le serveur tourne déjà sous **systemd**, **Docker** ou **Pterodactyl**. |
| `modey-server status` | Interroge la centrale pour afficher l'état en direct du serveur et ses badges de certification. |
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
    "api_url": "https://auth.modey.fr",
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
