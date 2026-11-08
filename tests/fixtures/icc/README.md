# ICC test profile

`CGATS001Compat-v2-micro.icc` comes from
[Compact ICC Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles),
which dedicates its profiles to the public domain under CC0. The upstream
license is included as `CC0-LICENSE.txt`.

This compact CMYK profile is a test fixture, not a recommended press condition.
Production documents should use the profile supplied by their printer.

`lcms-test-output.icc` is `testbed/test1.icc` from the MIT-licensed
[LittleCMS upstream tests](https://github.com/mm2/Little-CMS/tree/master/testbed).
Its embedded description explicitly says it is not suitable for real use.
`LCMS-LICENSE.txt` contains the upstream license. This profile exercises an
actual CMYK output transform and must never be offered as a production preset.
