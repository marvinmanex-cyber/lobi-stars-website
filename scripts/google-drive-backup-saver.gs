// Lobi Stars website: saves the weekly encrypted backup emails into Google Drive.
//
// Runs inside the Google account that receives the emails (dkakaan2@gmail.com),
// free, at script.google.com. It copies each "weekly encrypted backup" attachment
// into the Drive folder "Lobi Stars website backups", labels the email as saved,
// and keeps the newest 12 files (about 3 months). Setup steps: DISASTER-RECOVERY.md,
// Part 1. The files are locked with the backup key; never keep the key in Drive.

const FOLDER = 'Lobi Stars website backups';
const KEEP = 12;
const LABEL = 'Lobi backup saved';

function saveLobiBackups() {
  const folders = DriveApp.getFoldersByName(FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER);
  const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  const threads = GmailApp.search(`from:lobistarsfc.com subject:"weekly encrypted backup" has:attachment -label:"${LABEL}"`);
  let saved = 0;
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      for (const file of message.getAttachments()) {
        const name = file.getName();
        if (!/^lobi-stars-encrypted-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
        if (folder.getFilesByName(name).hasNext()) continue; // already saved
        folder.createFile(file.copyBlob()).setName(name);
        saved++;
      }
    }
    thread.addLabel(label);
  }
  // Keep the newest files only.
  const files = [];
  const all = folder.getFiles();
  while (all.hasNext()) {
    const f = all.next();
    if (f.getName().startsWith('lobi-stars-encrypted-backup-')) files.push(f);
  }
  files.sort((a, b) => b.getName().localeCompare(a.getName())).slice(KEEP).forEach(f => f.setTrashed(true));
  Logger.log(`Saved ${saved} new backup file(s); ${Math.min(files.length, KEEP)} kept in "${FOLDER}".`);
}
