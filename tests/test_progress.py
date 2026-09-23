import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('startup_progress', Path(__file__).parents[1] / 'scripts/progress.py')
progress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progress)

class ProgressTests(unittest.TestCase):
    def test_atomic_record_has_stable_run_identity_and_no_secrets(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'progress.json'
            progress.write_progress(path, 'backing_up', '2026-09-23T00:00:01Z')
            progress.write_progress(path, 'downloading', '2026-09-23T00:00:01Z')
            record = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(record['phase'], 'downloading')
            self.assertEqual(record['startedAt'], '2026-09-23T00:00:01Z')
            self.assertEqual(set(record), {'phase', 'startedAt', 'updatedAt'})
            self.assertFalse(Path(str(path) + '.tmp').exists())
            with self.assertRaises(ValueError):
                progress.write_progress(path, 'injected status', record['startedAt'])
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), record)
