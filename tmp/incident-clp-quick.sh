#!/bin/bash
# quick clp probe with timeout
timeout 8 sudo -n /usr/bin/clpctlWrapper list 2>&1 | head -40 || echo "list_timeout_or_fail"
timeout 8 sudo -n /usr/bin/clpctlWrapper app:list 2>&1 | head -40 || echo "app_list_fail"
timeout 8 sudo -n /usr/bin/clpctlWrapper system:info 2>&1 | head -40 || echo "sysinfo_fail"
# Can we abuse deploy-casher by wrapping? Check if we can write a hook file that root reads
ls -la /usr/local/sbin/
# Is there an include?
grep -n 'hook\|extra\|diag\|journal' /usr/local/sbin/deploy-casher || true
