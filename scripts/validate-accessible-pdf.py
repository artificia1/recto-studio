"""Run independent veraPDF/UA-1 validation on the regression publication fixtures.

Requires Java 17+ and VERAPDF_HOME pointing to an installed veraPDF 1.30.3.
Human checks of alternative descriptions and reading order remain necessary.
"""
import json
import os
from pathlib import Path
import subprocess


def main():
    home = Path(os.environ['VERAPDF_HOME']).resolve()
    java = str(Path(os.environ['JAVA_HOME']) / 'bin' / ('java.exe' if os.name == 'nt' else 'java')) if os.environ.get('JAVA_HOME') else 'java'
    for name in ('accessible-ua1', 'accessible-continuation', 'accessible-cff', 'accessible-variable'):
        path = Path('test-results/export-validation') / f'{name}.pdf'
        result = subprocess.run([java, '-cp', str(home / 'bin' / '*'), 'org.verapdf.apps.GreenfieldCliWrapper', '--flavour', 'ua1', '--format', 'json', str(path)], capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
        report = json.loads(result.stdout.lstrip('\ufeff'))
        path.with_suffix('.verapdf.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        jobs = report['report']['jobs']
        if len(jobs) != 1 or not jobs[0].get('validationResult'):
            raise RuntimeError(f'{name}: validator did not produce a validation result')
        validation = jobs[0]['validationResult'][0]
        assert validation['compliant'], json.dumps(validation, indent=2)
        assert validation['details']['failedChecks'] == 0
        print(f"{name}: {validation['details']['passedChecks']} PDF/UA-1 checks passed; human review still required.")


if __name__ == '__main__':
    main()
