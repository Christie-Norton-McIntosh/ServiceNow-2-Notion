#!/usr/bin/env bash
# Create a compressed tarball of the latest modules-server-dist-backup directory
# excluding any node_modules directories. Also creates a sha256 checksum.

set -eu

workspace_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$workspace_root"

backup_dir=$(find backups -maxdepth 1 -type d -name 'modules-server-dist-backup-*' -print | sort -r | head -1)
backup_dir_abs="$workspace_root/$backup_dir"
if [[ -z "$backup_dir" ]]; then
  echo "No backup directory found matching backups/modules-server-dist-backup-*"
  exit 1
fi

tar_path="$workspace_root/${backup_dir}.no_node_modules.tar.gz"
echo "Creating tarball: $tar_path"

# Create the tarball while excluding all node_modules directories anywhere under the backup
cd "$backup_dir_abs"
tar -czvf "$tar_path" --exclude='./**/node_modules' --exclude='./**/node_modules/*' --exclude='./node_modules' .

# Confirm contents and create checksum
echo "Listing top entries in archive (first 50):"
tar -tzf "$tar_path" | head -n 50

ls -lh "$tar_path"
shasum -a 256 "$tar_path" > "$tar_path".sha256
echo "Checksum written: $tar_path.sha256"

echo "Done. You can verify the archive with: tar -tzf $tar_path"
