"""Persist startup stages for the read-only admin panel mount; never include secrets."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys


def write_progress(path, phase, started_at):
    if phase not in {'backing_up', 'downloading', 'configuring', 'starting', 'failed'}:
        raise ValueError('Invalid startup phase')
    record = {'phase': phase, 'startedAt': started_at,
              'updatedAt': datetime.now(timezone.utc).isoformat()}
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(record, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(0o644)
    os.replace(temporary, path)


if __name__ == '__main__':
    write_progress(Path(os.environ.get('SERVER_FILES', '/home/steam/server-files')) / '.dragonwilds-startup.json',
                   sys.argv[1], os.environ['STARTUP_AT'])
