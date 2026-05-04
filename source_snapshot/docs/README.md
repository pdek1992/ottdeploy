# VigilSiddhi OTT

A premium, cinematic streaming experience powered by VigilSiddhi.

- **Unified Authorization**: Secure access management using GitHub Raw allowlists for enterprise-grade control.
- **Secure Playback**: High-fidelity DASH streaming via Shaka Player, with robust multi-origin failover (CDN, R2, and local fallback).
- **ClearKey Encryption**: Advanced AES-CENC/ClearKey security implementation across all streaming assets.
- **Dynamic Metadata**: Real-time thumbnail discovery and content descriptions managed through an encrypted JSON layer.
- **Ad Solutions**: Integrated support for Google IMA and SCTE-35 marker hooks for seamless monetization.
- **Experience**: Progressive Web App (PWA) with native-feel features including Media Session actions, Picture-in-Picture, and biometric WebAuthn security.

## Deployment & Setup

### Local Environment
To run the VigilSiddhi OTT application locally:

```powershell
python -m http.server 4173
```

Access the portal at `http://localhost:4173`.

### Configuration
Centralized settings are managed in `config.js`:
- **Auth & Content URLs**: Configure `allowedEmailsUrl`, `descriptionsUrl`, and `mpdMappingUrl`.
- **Infrastructure**: Update `cdnBaseUrl` and `r2BaseUrl` for production routing.
- **Security**: Manage the `fixedKeyPassphrase` for the encrypted configuration layer.
- **Ads**: Link your production `googleImaAdTag`.

### Key Management
Use the integrated **OTT Key Encryptor** utility in `tools/key-encryptor.html` to manage encrypted payload versions of:
- `allowed_emails.json`
- `allowed_userids.json`
- `description.json`
- `mpd_mapping.json`
- `keys.json`

## Architecture Note
VigilSiddhi OTT is designed as a secure, static-hosted frontend. While it implements client-side decryption for ease of management, production environments should complement this with server-side authorization and enterprise DRM providers for maximum asset protection.
