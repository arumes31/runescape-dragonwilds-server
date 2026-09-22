import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('backup', Path(__file__).parents[1] / 'scripts/backup.py')
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_backup_contains_saves_and_only_prunes_its_own_archives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved = root / 'Saved'
            saved.mkdir()
            (saved / 'world.sav').write_text('world data')
            dest = root / 'backups'
            dest.mkdir()
            unrelated = dest / 'keep.tar.gz'
            unrelated.write_text('keep')
            for _ in range(3):
                archive = backup.create(saved, dest, 2)
            self.assertEqual(len(list(dest.glob('saved-*.tar.gz'))), 2)
            self.assertTrue(unrelated.exists())
            with tarfile.open(archive) as tar:
                self.assertEqual(tar.extractfile('Saved/world.sav').read(), b'world data')

    def test_first_boot_does_not_create_empty_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertIsNone(backup.create(root / 'missing', root / 'backups', 2))
