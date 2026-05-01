import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const HERE = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'dev-server': 'src/dev-server/index.ts',
    react: 'src/react/index.tsx',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Native binding (keytar) and peers (zod, react) stay external so
  // the bundle doesn't try to inline either. Other deps inline
  // freely; tree-shaking on the consumer side handles per-entry
  // stripping.
  external: ['keytar', 'zod', 'react', 'react/jsx-runtime'],
  // Two post-build steps:
  //   1. Copy the placeholder icon the `init` command scaffolds.
  //   2. Prepend `#!/usr/bin/env node` to dist/cli.js + dist/cli.cjs.
  //      tsup's `banner` callback only sees `format`, not per-entry,
  //      so a per-file post-process is the simplest gate that keeps
  //      the shebang OFF the library bundle (which would break
  //      browser bundlers that follow the import map).
  async onSuccess() {
    // (1) Asset copy.
    const iconSrc = resolve(HERE, 'src/cli/templates/_shared/icon.svg');
    const iconDst = resolve(HERE, 'dist/cli/templates/_shared/icon.svg');
    await mkdir(dirname(iconDst), { recursive: true });
    await copyFile(iconSrc, iconDst);

    // (2) Shebang on the CLI bundles only, plus chmod +x so the
    // `bin` symlink npm creates is directly executable.
    const SHEBANG = '#!/usr/bin/env node\n';
    for (const file of ['dist/cli.js', 'dist/cli.cjs']) {
      const path = resolve(HERE, file);
      const body = await readFile(path, 'utf8');
      if (!body.startsWith('#!')) {
        await writeFile(path, SHEBANG + body);
      }
      await chmod(path, 0o755);
    }
  },
});
