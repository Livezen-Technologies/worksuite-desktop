#!/usr/bin/env python3
"""Build a Debian package from electron-builder's linux-unpacked output, on macOS.

electron-builder's deb target runs fpm, which needs GNU tar (not on this Mac).
This lays the files out the way electron-builder's deb does and writes the ar
archive itself, byte for byte, the way dpkg-deb does.
"""
import os, sys, shutil, subprocess, tarfile, io, time, gzip, stat

src, icons, out, version = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
work = out + '.work'
shutil.rmtree(work, ignore_errors=True)
root = os.path.join(work, 'root')
os.makedirs(os.path.join(root, 'opt'))
shutil.copytree(src, os.path.join(root, 'opt', 'WorkSuite'), symlinks=True)

# AppArmor: Ubuntu 24.04+ blocks unprivileged user namespaces unless the app has a profile.
with open(os.path.join(root, 'opt', 'WorkSuite', 'resources', 'apparmor-profile'), 'w') as f:
    f.write('abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile worksuite "/opt/WorkSuite/worksuite" flags=(unconfined) {\n  userns,\n\n  # Site-specific additions and overrides. See local/README for details.\n  include if exists <local/worksuite>\n}\n')

apps = os.path.join(root, 'usr', 'share', 'applications')
os.makedirs(apps)
with open(os.path.join(apps, 'worksuite.desktop'), 'w') as f:
    f.write('[Desktop Entry]\nName=WorkSuite\nExec=/opt/WorkSuite/worksuite %U\nTerminal=false\nType=Application\nIcon=worksuite\n'
            'StartupWMClass=WorkSuite\nComment=The WorkSuite desktop client\n'
            'MimeType=x-scheme-handler/worksuite;application/x-worksuite-reference;\nCategories=Office;\n')
for name in os.listdir(icons):
    if name.endswith('.png'):
        size = name[:-4]
        d = os.path.join(root, 'usr', 'share', 'icons', 'hicolor', size, 'apps')
        os.makedirs(d, exist_ok=True)
        shutil.copy(os.path.join(icons, name), os.path.join(d, 'worksuite.png'))

def installed_kb(path):
    total = 0
    for dp, dn, fn in os.walk(path):
        for n in fn:
            p = os.path.join(dp, n)
            if not os.path.islink(p):
                total += os.path.getsize(p)
    return (total + 1023) // 1024

control = f"""Package: worksuite
Version: {version}
Section: default
Priority: optional
Architecture: amd64
Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libgbm1, libasound2 | libasound2t64
Recommends: xdotool, x11-utils
Installed-Size: {installed_kb(root)}
Maintainer: Livezen Technologies <noreply@worksuite.lk>
Homepage: https://worksuite.lk
Description: The WorkSuite desktop client
 WorkSuite Desktop: mail, chat, tasks, files and every WorkSuite app on your
 desktop.
"""

postinst = r"""#!/bin/bash
# The command on the path, through alternatives where they exist.
if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/worksuite' -a -e '/usr/bin/worksuite' -a "$(readlink '/usr/bin/worksuite')" != '/etc/alternatives/worksuite' ]; then
    rm -f '/usr/bin/worksuite'
  fi
  update-alternatives --install '/usr/bin/worksuite' 'worksuite' '/opt/WorkSuite/worksuite' 100 || ln -sf '/opt/WorkSuite/worksuite' '/usr/bin/worksuite'
else
  ln -sf '/opt/WorkSuite/worksuite' '/usr/bin/worksuite'
fi

# Chromium's sandbox: SUID only where user namespaces do not work.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; } 2>/dev/null; then
  chmod 4755 '/opt/WorkSuite/chrome-sandbox' || true
else
  chmod 0755 '/opt/WorkSuite/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
if hash gtk-update-icon-cache 2>/dev/null; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi

# AppArmor (Ubuntu 24.04+): install the bundled profile where this AppArmor understands it.
APPARMOR_PROFILE_SOURCE='/opt/WorkSuite/resources/apparmor-profile'
APPARMOR_PROFILE_TARGET='/etc/apparmor.d/worksuite'
if apparmor_status --enabled >/dev/null 2>&1; then
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" >/dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET" || true
    fi
  else
    echo "Skipping the AppArmor profile: this AppArmor does not support it."
  fi
fi

# As build/linux/after-install-deb.tpl: the package type for the in-app updater (#345), and the WorkSuite package
# source only in a WORKSUITE_LINUX_REPO=1 build, which carries resources/linux-repo and the helper (#351).
[ -s '/opt/WorkSuite/resources/package-type' ] || echo deb > '/opt/WorkSuite/resources/package-type' || true
if [ -f '/opt/WorkSuite/resources/linux-repo' ] && [ -x '/opt/WorkSuite/resources/worksuite-repo' ]; then
  '/opt/WorkSuite/resources/worksuite-repo' setup deb || echo 'WorkSuite: the package repository was not set up; Settings > Updates > Diagnostics can fix it.' >&2
fi
exit 0
"""

postrm = r"""#!/bin/bash
case "$1" in
  remove|purge)
    if type update-alternatives >/dev/null 2>&1; then
      update-alternatives --remove 'worksuite' '/opt/WorkSuite/worksuite' || true
    fi
    if [ -L '/usr/bin/worksuite' ] && [ "$(readlink '/usr/bin/worksuite')" = '/opt/WorkSuite/worksuite' ]; then rm -f '/usr/bin/worksuite'; fi
    if [ -f '/etc/apparmor.d/worksuite' ]; then
      if hash apparmor_parser 2>/dev/null; then apparmor_parser --remove '/etc/apparmor.d/worksuite' >/dev/null 2>&1 || true; fi
      rm -f '/etc/apparmor.d/worksuite'
    fi
    rm -f '/opt/WorkSuite/resources/package-type'
    rmdir '/opt/WorkSuite/resources' '/opt/WorkSuite' 2>/dev/null || true
    if grep -qs '^# Written by WorkSuite' '/etc/apt/sources.list.d/worksuite.sources'; then rm -f '/etc/apt/sources.list.d/worksuite.sources'; fi
    if [ ! -e '/etc/apt/sources.list.d/worksuite.sources' ]; then rm -f '/usr/share/keyrings/worksuite.gpg'; fi
    ;;
esac
exit 0
"""

now = int(time.time())

def add(tar, arcname, data=None, path=None, mode=0o644):
    if path is not None:
        ti = tar.gettarinfo(path, arcname)
    else:
        ti = tarfile.TarInfo(arcname)
        ti.size = len(data)
        ti.mode = mode
        ti.mtime = now
    ti.uid = ti.gid = 0
    ti.uname = ti.gname = 'root'
    if ti.isreg() and path is not None:
        with open(path, 'rb') as fh:
            tar.addfile(ti, fh)
    elif data is not None:
        tar.addfile(ti, io.BytesIO(data))
    else:
        tar.addfile(ti)

def targz(build):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb', mtime=now) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.GNU_FORMAT) as tar:
            build(tar)
    return buf.getvalue()

def control_tar(tar):
    add(tar, './', data=b'', mode=0o755) if False else None
    ti = tarfile.TarInfo('./'); ti.type = tarfile.DIRTYPE; ti.mode = 0o755; ti.mtime = now; ti.uname = ti.gname = 'root'; tar.addfile(ti)
    add(tar, './control', control.encode())
    add(tar, './postinst', postinst.encode(), mode=0o755)
    add(tar, './postrm', postrm.encode(), mode=0o755)

def data_tar(tar):
    for dp, dn, fn in os.walk(root):
        dn.sort(); fn.sort()
        rel = os.path.relpath(dp, root)
        arc = './' if rel == '.' else './' + rel + '/'
        ti = tarfile.TarInfo(arc); ti.type = tarfile.DIRTYPE; ti.mode = 0o755; ti.mtime = now; ti.uname = ti.gname = 'root'; tar.addfile(ti)
        for n in fn:
            p = os.path.join(dp, n)
            arcn = ('./' if rel == '.' else './' + rel + '/') + n
            ti = tar.gettarinfo(p, arcn)
            ti.uid = ti.gid = 0; ti.uname = ti.gname = 'root'
            if ti.isreg():
                ti.mode = 0o755 if (os.stat(p).st_mode & stat.S_IXUSR) else 0o644
                with open(p, 'rb') as fh:
                    tar.addfile(ti, fh)
            else:
                tar.addfile(ti)
        # symlinked directories are walked as files by os.walk only if followlinks; record them as links
        for d in list(dn):
            p = os.path.join(dp, d)
            if os.path.islink(p):
                ti = tar.gettarinfo(p, ('./' if rel == '.' else './' + rel + '/') + d)
                ti.uid = ti.gid = 0; ti.uname = ti.gname = 'root'
                tar.addfile(ti)
                dn.remove(d)

members = [('debian-binary', b'2.0\n'), ('control.tar.gz', targz(control_tar)), ('data.tar.gz', targz(data_tar))]
with open(out, 'wb') as f:
    f.write(b'!<arch>\n')
    for name, data in members:
        header = name.ljust(16).encode() + str(now).ljust(12).encode() + b'0     ' + b'0     ' + b'100644  ' + str(len(data)).ljust(10).encode() + b'`\n'
        assert len(header) == 60
        f.write(header)
        f.write(data)
        if len(data) % 2:
            f.write(b'\n')
shutil.rmtree(work, ignore_errors=True)
print(out, os.path.getsize(out))
