"""Install the pinned official validator into test-results; never bundled with Recto."""
from hashlib import sha256
from pathlib import Path
import subprocess
import urllib.request
import zipfile

folder = Path('test-results/validators').resolve()
folder.mkdir(parents=True, exist_ok=True)
archive = folder / 'verapdf-installer.zip'
url = 'https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.3-installer.zip'
with urllib.request.urlopen(url, timeout=90) as response:
    archive.write_bytes(response.read(40 * 1024 * 1024))
assert sha256(archive.read_bytes()).hexdigest() == 'b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59', 'Validator archive checksum mismatch'
with zipfile.ZipFile(archive) as installer:
    # Extract only the verified installer JAR; no archive paths are used as output paths.
    jars = [name for name in installer.namelist() if name.endswith('/verapdf-izpack-installer-1.30.3.jar')]
    assert len(jars) == 1
    jar = folder / 'installer.jar'
    jar.write_bytes(installer.read(jars[0]))
home = folder / 'verapdf'
settings = folder / 'auto.xml'
settings.write_text(f'''<AutomatedInstallation langpack="eng">
<com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
<com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>{home.as_posix()}</installpath></com.izforge.izpack.panels.target.TargetPanel>
<com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
<pack index="0" name="veraPDF GUI" selected="true"/>
<pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
<pack index="2" name="veraPDF Validation model" selected="false"/>
<pack index="3" name="veraPDF Documentation" selected="false"/>
<pack index="4" name="veraPDF Sample Plugins" selected="false"/>
</com.izforge.izpack.panels.packs.PacksPanel>
<com.izforge.izpack.panels.install.InstallPanel id="install"/>
<com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>''', encoding='utf-8')
subprocess.run(['java', '-jar', str(jar), str(settings)], check=True, timeout=120)
print(f'veraPDF 1.30.3 installed at {home}')
