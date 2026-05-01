import sys
import os
import logging
import json

sys.path.insert(0, r"X:\AirstepStudio\src")
from sync_manager import SyncManager

logging.basicConfig(level=logging.WARNING)

class MockProvider:
    def __init__(self):
        self.host = "mock"
    def list_files(self):
        return {}
    def upload_file(self, *args): pass
    def download_file(self, *args): pass

def test_sync():
    local_dir = r"X:\TMP\AirStepStudio"
    
    remote_provider = MockProvider()
    sync_manager = SyncManager(local_dir, remote_provider)
    
    print("Starting analysis...")
    result = sync_manager.analyze(mode="Bidirectionnel (Auto)")
    
    push = result.get('push', [])
    print(f"Push: {len(push)}")
    for p in push:
        if 'Rough Boy' in p['path']:
            print(f"FOUND IN PUSH: {p['path']} (Reason: {p['reason']})")
        if 'Rough Boy' in p['path'] and p['path'].endswith('.json'):
            print(f"FOUND SIDECAR IN PUSH: {p['path']}")

if __name__ == "__main__":
    test_sync()
