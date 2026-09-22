import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('config', Path(__file__).parents[1] / 'scripts/config.py')
config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.env = {'OWNER_ID': 'a' * 32, 'ADMIN_PASSWORD': 'test-secret', 'DEFAULT_WORLD_NAME': 'A world'}

    def test_preserves_identity_repeated_players_unknown_fields_and_sections(self):
        old = '[Other]\nServerName=Other\n[/Script/Dominion.DedicatedServerSettings]\nServerGuid=stable\nKnownPlayerList=one\nKnownPlayerList=two\nCustom=value\nServerName=old\n'
        result = config.render(old, self.env)
        for value in ['ServerGuid=stable', 'KnownPlayerList=one', 'KnownPlayerList=two', 'Custom=value', '[Other]\nServerName=Other']:
            self.assertIn(value, result)
        self.assertIn('DefaultWorldName=A world', result)
        self.assertNotIn('ServerName=old', result)
        self.assertEqual(config.render(result, self.env), result)

    def test_literals_do_not_expand_and_comments_in_world_name_are_rejected(self):
        self.env['ADMIN_PASSWORD'] = 'literal $secret # hash'
        self.assertIn('AdminPassword=literal $secret # hash', config.render('', self.env))
        self.env['DEFAULT_WORLD_NAME'] = 'MyWorld\t# an inline comment'
        with self.assertRaises(ValueError):
            config.render('', self.env)

    def test_invalid_values_fail_before_writing(self):
        for name, value in [('OWNER_ID', 'oops'), ('ADMIN_PASSWORD', ''), ('DEFAULT_PORT', '0'), ('DEFAULT_PORT', '65000'), ('MAX_PLAYERS', 'oops'), ('PUID', '0'), ('SERVER_NAME', 'x\nOwnerId=bad'), ('DEFAULT_WORLD_NAME', '../world'), ('UPDATE_ON_START', 'maybe')]:
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    config.validate({**self.env, name: value})

    def test_manual_mode_does_not_rewrite_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'DedicatedServer.ini'
            original = config.render('', self.env)
            path.write_text(original)
            config.configure(path, {**self.env, 'SERVER_NAME': 'changed', 'GENERATE_SETTINGS': 'false'})
            self.assertEqual(path.read_text(), original)

    def test_alias_for_pr7_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'DedicatedServer.ini'
            path.write_text(config.render('', self.env))
            original = path.read_bytes()
            config.configure(path, {**self.env, 'REGENERATE_SERVER_INI_ON_RESTART': 'false'})
            self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
