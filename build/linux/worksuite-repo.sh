#!/bin/sh
# The WorkSuite APT / DNF package source (worksuite-desktop#351), written as root.
#
# Only builds made with WORKSUITE_LINUX_REPO=1 ship this helper, as resources/worksuite-repo, together with
# resources/linux-repo (the repository's address and the build's channel) and the repository's public key
# (resources/worksuite-repo.gpg, and .asc for rpm). build/linux-repo.cjs puts them there. The package's
# after-install script runs it; WorkSuite runs it through pkexec when the update channel changes and from
# Settings > Updates > Diagnostics > Fix. electron/updater/linux-repo.ts generates the same files, byte for byte.
#
#   worksuite-repo setup <deb|rpm> [stable|beta|dev] [--refresh]
#       Installs the key and the source file. Without a channel the file's current suite is kept (an upgrade
#       never moves a computer to another channel), else the build's own channel. --refresh also reads the
#       repository's package lists (apt-get update / dnf makecache, for this source only).
#   worksuite-repo remove
#       Removes the files it wrote (only a source file that carries its header line, and then the key).
#   worksuite-repo print <deb|rpm> <stable|beta|dev> <https-url>
#       Prints the source file (tests and documentation; changes nothing).
#
# Exit 3: this build does not use the repository (no resources/linux-repo), and nothing was changed.
set -eu

# Tests only: write under a scratch directory and read another resources directory. pkexec clears the
# environment, so neither can reach a run through pkexec.
ROOT=${WORKSUITE_REPO_ROOT:-}
RES=${WORKSUITE_REPO_RESOURCES:-$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)}

APT_SOURCES=$ROOT/etc/apt/sources.list.d/worksuite.sources
APT_KEYRING=$ROOT/usr/share/keyrings/worksuite.gpg
YUM_REPO=$ROOT/etc/yum.repos.d/worksuite.repo
RPM_KEY=$ROOT/etc/pki/rpm-gpg/RPM-GPG-KEY-worksuite
HEADER='# Written by WorkSuite (worksuite-desktop#351). Changing the update channel in WorkSuite rewrites this file.'

fail() {
  code=$1
  shift
  echo "worksuite-repo: $*" >&2
  exit "$code"
}

valid_kind() { case "$1" in deb | rpm) return 0 ;; *) return 1 ;; esac }
valid_suite() { case "$1" in stable | beta | dev) return 0 ;; *) return 1 ;; esac }
valid_url() { printf '%s\n' "$1" | grep -Eqx 'https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?'; }

marker_value() { sed -n "s/^$1=//p" "$RES/linux-repo" 2>/dev/null | head -n 1 | tr -d '[:space:]'; }

print_source() { # kind suite url
  if [ "$1" = deb ]; then
    printf '%s\nTypes: deb\nURIs: %s/apt\nSuites: %s\nComponents: main\nSigned-By: /usr/share/keyrings/worksuite.gpg\n' "$HEADER" "$3" "$2"
  else
    printf '%s\n[worksuite]\nname=WorkSuite Desktop (%s)\nbaseurl=%s/rpm/%s\nenabled=1\ngpgcheck=0\nrepo_gpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-worksuite\nmetadata_expire=6h\n' "$HEADER" "$2" "$3" "$2"
  fi
}

current_suite() { # kind
  if [ "$1" = deb ]; then
    sed -n 's/^Suites:[[:space:]]*\([A-Za-z0-9_-]*\).*/\1/p' "$APT_SOURCES" 2>/dev/null | head -n 1
  else
    sed -n 's|^baseurl[[:space:]]*=.*/rpm/\([A-Za-z0-9_-]*\).*|\1|p' "$YUM_REPO" 2>/dev/null | head -n 1
  fi
}

install_file() { # target mode, content on stdin; replaced in one rename
  mkdir -p "$(dirname -- "$1")"
  cat >"$1.worksuite-new"
  chmod "$2" "$1.worksuite-new"
  mv -f "$1.worksuite-new" "$1"
}

setup() {
  kind=${1:-}
  suite=${2:-}
  refresh=${3:-}
  if [ "$suite" = --refresh ]; then
    suite=''
    refresh=--refresh
  fi
  valid_kind "$kind" || fail 2 "usage: worksuite-repo setup <deb|rpm> [stable|beta|dev] [--refresh]"
  [ -f "$RES/linux-repo" ] || fail 3 "this build does not use the WorkSuite package repository; nothing changed"
  url=$(marker_value url)
  url=${url%/}
  valid_url "$url" || fail 1 "resources/linux-repo has no valid https url"
  if [ -z "$suite" ]; then
    suite=$(current_suite "$kind")
    valid_suite "$suite" || suite=$(marker_value channel)
    valid_suite "$suite" || suite=stable
  fi
  valid_suite "$suite" || fail 2 "unknown channel: $suite (stable, beta or dev)"

  if [ "$kind" = deb ]; then
    [ -s "$RES/worksuite-repo.gpg" ] || fail 1 "the repository key is missing from $RES"
    install_file "$APT_KEYRING" 0644 <"$RES/worksuite-repo.gpg"
    print_source deb "$suite" "$url" | install_file "$APT_SOURCES" 0644
  else
    [ -s "$RES/worksuite-repo.asc" ] || fail 1 "the repository key is missing from $RES"
    install_file "$RPM_KEY" 0644 <"$RES/worksuite-repo.asc"
    print_source rpm "$suite" "$url" | install_file "$YUM_REPO" 0644
  fi
  echo "worksuite-repo: $kind source set to $suite ($url)"

  if [ "$refresh" = --refresh ] && [ -z "$ROOT" ]; then
    if [ "$kind" = deb ]; then
      apt-get update -o Dir::Etc::sourcelist="$APT_SOURCES" -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
    elif command -v dnf >/dev/null 2>&1; then
      dnf makecache --repo worksuite
    elif command -v yum >/dev/null 2>&1; then
      yum makecache --disablerepo='*' --enablerepo=worksuite
    fi
  fi
}

remove() {
  if grep -qs '^# Written by WorkSuite' "$APT_SOURCES"; then rm -f "$APT_SOURCES"; fi
  if [ ! -e "$APT_SOURCES" ]; then rm -f "$APT_KEYRING"; fi
  if grep -qs '^# Written by WorkSuite' "$YUM_REPO"; then rm -f "$YUM_REPO"; fi
  if [ ! -e "$YUM_REPO" ]; then rm -f "$RPM_KEY"; fi
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  setup) setup "$@" ;;
  remove) remove ;;
  print)
    valid_kind "${1:-}" && valid_suite "${2:-}" && valid_url "${3:-}" || fail 2 "usage: worksuite-repo print <deb|rpm> <stable|beta|dev> <https-url>"
    print_source "$1" "$2" "$3"
    ;;
  *) fail 2 "usage: worksuite-repo setup|remove|print …" ;;
esac
