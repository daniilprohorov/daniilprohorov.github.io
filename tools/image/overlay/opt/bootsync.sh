#!/bin/sh
# put other system startup commands here, the boot process will wait until they complete.
# Use bootlocal.sh for system startup commands that can run in the background 
# and therefore not slow down the boot process.
/usr/bin/sethostname box

# Desktop image: finish installing the extensions baked into the initrd, as
# tce-load would, before autologin runs startx.
for ext in $(cat /usr/local/etc/desktop-extensions.lst); do
	[ -s /usr/local/tce.installed/"$ext" ] && /bin/sh /usr/local/tce.installed/"$ext" < /dev/null
done
# open-webapp runs as the desktop user and talks to the page over COM1.
chmod 666 /dev/ttyS0

/opt/bootlocal.sh &
