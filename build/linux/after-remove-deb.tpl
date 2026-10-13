#!/bin/bash

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
# Uninstall or purge (not an upgrade, which runs this with "upgrade"): the package type file the after-install
# script wrote, and the WorkSuite package source and key (worksuite-desktop#351). Only a source file carrying
# WorkSuite's header is removed (one the administrator wrote stays), and the key only once no source file is left.
case "$1" in
  remove|purge)
    rm -f '/opt/${sanitizedProductName}/resources/package-type'
    rmdir '/opt/${sanitizedProductName}/resources' '/opt/${sanitizedProductName}' 2>/dev/null || true
    if grep -qs '^# Written by WorkSuite' '/etc/apt/sources.list.d/worksuite.sources'; then rm -f '/etc/apt/sources.list.d/worksuite.sources'; fi
    if [ ! -e '/etc/apt/sources.list.d/worksuite.sources' ]; then rm -f '/usr/share/keyrings/worksuite.gpg'; fi
    ;;
esac
