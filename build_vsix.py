import argparse
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_FILES = ["extension.js", "README.md", "media"]

CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension=".json" ContentType="application/json"/>
<Default Extension=".js" ContentType="application/javascript"/>
<Default Extension=".css" ContentType="text/css"/>
<Default Extension=".svg" ContentType="image/svg+xml"/>
<Default Extension=".png" ContentType="image/png"/>
<Default Extension=".md" ContentType="text/markdown"/>
<Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>"""

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata>
<Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}"/>
<DisplayName>{display_name}</DisplayName>
<Description xml:space="preserve">{description}</Description>
<Properties>
<Property Id="Microsoft.VisualStudio.Code.Engine" Value="{engine}"/>
</Properties>
</Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
<Dependencies/>
<Assets>
<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
</Assets>
</PackageManifest>"""


class VsixBuilder:
    """Packages a plain-JavaScript VS Code extension into a .vsix without Node tooling."""

    def __init__(self, root: Path):
        self.root = root
        self.package = json.loads((root / "package.json").read_text())
        self.include = ["package.json", *self.package.get("files", DEFAULT_FILES)]

    @property
    def output(self) -> Path:
        return self.root / f"{self.package['name']}-{self.package['version']}.vsix"

    def files(self):
        """Yield every file to bundle."""
        for entry in self.include:
            path = self.root / entry
            if path.is_dir():
                yield from (p for p in sorted(path.rglob("*")) if p.is_file())
            elif path.exists():
                yield path

    def manifest(self) -> str:
        p = self.package
        return MANIFEST.format(
            name=p["name"],
            version=p["version"],
            publisher=p["publisher"],
            display_name=p.get("displayName", p["name"]),
            description=p.get("description", ""),
            engine=p["engines"]["vscode"],
        )

    def build(self) -> Path:
        """Write the .vsix archive and return its path."""
        with zipfile.ZipFile(self.output, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", CONTENT_TYPES)
            zf.writestr("extension.vsixmanifest", self.manifest())
            for path in self.files():
                zf.write(path, f"extension/{path.relative_to(self.root).as_posix()}")
        return self.output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=VsixBuilder.__doc__)
    parser.add_argument("extension_dir", nargs="?", type=Path, default=ROOT, help="extension folder (default: this script's folder)")
    print(VsixBuilder(parser.parse_args().extension_dir.resolve()).build())
