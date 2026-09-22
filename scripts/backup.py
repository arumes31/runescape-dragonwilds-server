"""Offline pre-update backups; only called while the game is stopped."""
from datetime import datetime, timezone
import os
from pathlib import Path
import tarfile


def create(saved, destination, keep):
    if not saved.exists():
        return None
    destination.mkdir(parents=True, exist_ok=True)
    name = 'saved-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.tar.gz'
    archive = destination / name
    temporary = destination / (name + '.partial')
    try:
        with tarfile.open(temporary, 'w:gz') as stream:
            stream.add(saved, arcname='Saved')
        temporary.chmod(0o600)
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)
    for old in sorted(destination.glob('saved-*.tar.gz'), reverse=True)[keep:]:
        old.unlink()
    return archive


if __name__ == '__main__':
    result = create(Path(os.environ.get('SERVER_FILES', '/home/steam/server-files')) / 'RSDragonwilds/Saved',
                    Path('/backups'), int(os.environ.get('BACKUP_KEEP', '7')))
    print(f'Pre-update backup: {result.name}' if result else 'First installation: no existing saves to back up', flush=True)
