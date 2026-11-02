import fs from 'node:fs';

// Minimal package.xml editing: enough to add members without an XML library.
export function readMembers(manifestPath, type) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return [];
  const xml = fs.readFileSync(manifestPath, 'utf8');
  const members = [];
  for (const block of xml.match(/<types>[\s\S]*?<\/types>/g) || []) {
    if (block.includes(`<name>${type}</name>`)) {
      for (const m of block.matchAll(/<members>([^<]+)<\/members>/g)) members.push(m[1].trim());
    }
  }
  return members;
}

export function addToManifest(manifestPath, type, member) {
  let xml = fs.readFileSync(manifestPath, 'utf8');
  const blocks = xml.match(/<types>[\s\S]*?<\/types>/g) || [];
  for (const block of blocks) {
    if (block.includes(`<name>${type}</name>`)) {
      if (block.includes(`<members>${member}</members>`)) return false;
      const updated = block.replace(`<name>${type}</name>`, `<members>${member}</members>\n        <name>${type}</name>`);
      fs.writeFileSync(manifestPath, xml.replace(block, updated));
      return true;
    }
  }
  const newBlock = `    <types>\n        <members>${member}</members>\n        <name>${type}</name>\n    </types>\n`;
  if (/\n[ \t]*<version>/.test(xml)) {
    xml = xml.replace(/\n([ \t]*)<version>/, `\n${newBlock}$1<version>`);
  } else {
    xml = xml.replace('</Package>', `${newBlock}</Package>`);
  }
  fs.writeFileSync(manifestPath, xml);
  return true;
}
