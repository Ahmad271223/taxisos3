#!/usr/bin/env bash
# Alle QA-Reihen nacheinander ausfuehren.
#
# WICHTIG: Zwischen den Reihen wird der Server NEU GESTARTET. Grund: Sockets
# aus einer vorherigen Reihe bleiben sonst offen, waehrend das Aufraeumen ihre
# Fahrer aus der Datenbank loescht. Die naechste Reihe laeuft dann gegen einen
# Dispatcher, der sich noch an geloeschte Fahrer erinnert – Ergebnisse werden
# unzuverlaessig (genau das hat hier schon dreimal falsche Fehler erzeugt).
#
# Aufruf:  bash scripts/qa/run-all.sh
set -u
cd "$(dirname "$0")/../.." || exit 1

LOG="${TEMP:-/tmp}/qa_server.log"
# Mit QA_REIHEN laesst sich die Auswahl eingrenzen, z. B. fuer die CI:
#   QA_REIHEN="security_refs tracking_eta" bash scripts/qa/run-all.sh
REIHEN=(
  frontend_walk dashboards security_refs pdf_names pdf_invoices driver_sync tracking_eta funds_check settle_race no_fake_success
  live_ready invoice_retired flights account_group payment_flow subscription
  plans_connect driver_confirm_replace chat_offline scheduled_freeze
  freeze_deadlock loadtest loadtest_heavy betrieb
)
if [ -n "${QA_REIHEN:-}" ]; then REIHEN=($QA_REIHEN); fi

stoppe_server() {
  # Plattformunabhaengig: unter Windows ueber PowerShell, sonst ueber pkill.
  # (Vorher lief das Skript ausschliesslich unter Windows.)
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -match 'taxisos3' -and \$_.CommandLine -notmatch 'modelcontextprotocol' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
  else
    pkill -f "tsx server.ts" >/dev/null 2>&1 || true
  fi
  sleep 3
}

starte_server() {
  rm -f "$LOG"
  # Ein beschaedigter .next-Cache laesst die Next-Worker mit EPIPE sterben.
  # Betroffene Routen antworten dann mit 500 statt mit ihrem echten Ergebnis –
  # der Testlauf meldet Dutzende Fehler, die keine sind. Deshalb vor dem
  # ersten Start einmal aufraeumen.
  if [ "${QA_CLEAN_NEXT:-1}" = "1" ] && [ -z "${QA_NEXT_BEREINIGT:-}" ]; then
    rm -rf .next
    QA_NEXT_BEREINIGT=1
  fi
  SMS_DISABLED=1 ENABLE_SIMULATOR=0 npx tsx server.ts > "$LOG" 2>&1 &
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null)" = "200" ]; then
      if grep -qi EADDRINUSE "$LOG"; then echo "    ! Alter Server laeuft noch"; return 1; fi
      return 0
    fi
    sleep 1
  done
  echo "    ! Server nicht gestartet"; return 1
}

gesamt=0; rot=""
for reihe in "${REIHEN[@]}"; do
  [ -f "scripts/qa/$reihe.js" ] || continue
  stoppe_server
  starte_server || { rot="$rot $reihe"; continue; }
  node scripts/qa/cleanup.js >/dev/null 2>&1
  printf "  %-24s " "$reihe"
  SMS_DISABLED=1 node "scripts/qa/$reihe.js" > "${TEMP:-/tmp}/qa_$reihe.log" 2>&1
  # Sind waehrend der Reihe Next-Worker gestorben, sind die Ergebnisse wertlos.
  if grep -q "WorkerError" "$LOG" 2>/dev/null; then
    echo "UNBRAUCHBAR (Next-Worker abgestuerzt)"; rot="$rot $reihe"; continue
  fi
  zeile=$(grep -E "^(OK|FEHLGESCHLAGEN) " "${TEMP:-/tmp}/qa_$reihe.log" | tail -1)
  if [ -z "$zeile" ]; then
    echo "ABBRUCH"; rot="$rot $reihe"
  else
    echo "$zeile"
    case "$zeile" in FEHLGESCHLAGEN*) rot="$rot $reihe";; esac
    # Die Logdateien haben Windows-Zeilenenden. Ohne das Entfernen aller
    # Nicht-Ziffern landet ein Wagenruecklauf in der Zahl und die Arithmetik
    # bricht mit einem Syntaxfehler ab, der den Durchlauf mittendrin beendet.
    n=$(echo "$zeile" | grep -oE "[0-9]+/[0-9]+" | head -1 | cut -d/ -f1 | tr -cd "0-9")
    gesamt=$((gesamt + ${n:-0}))
  fi
done

echo "--------------------------------------------------------"
echo "Gruene Pruefungen gesamt: $gesamt"
if [ -n "$rot" ]; then echo "Rote Reihen:$rot"; exit 1; else echo "Rote Reihen: keine"; fi
