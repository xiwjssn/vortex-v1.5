const fs = require('node:fs/promises');
const path = require('node:path');

async function preparePersistentDataDirectory(source, destination) {
  const sourcePath = path.resolve(source);
  const destinationPath = path.resolve(destination);
  if (sourcePath === destinationPath) return destinationPath;

  await fs.mkdir(destinationPath, { recursive: true, mode: 0o700 });
  try {
    // Copy only missing files. Never overwrite newer data already on the volume.
    await fs.cp(sourcePath, destinationPath, {
      recursive: true,
      force: false,
      errorOnExist: false
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.chmod(destinationPath, 0o700);
  return destinationPath;
}

module.exports = { preparePersistentDataDirectory };
