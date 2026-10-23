# Rebuilds the whole PostgreSQL database from the SQL files in /db.
# Run from the repo root, with the containers up (docker compose up -d):
#   powershell -ExecutionPolicy Bypass -File .\db\load_all.ps1
# WARNING: schema.sql drops and recreates every table, so all existing
# data is replaced by the seed data.

$files = @("settings", "schema", "seed", "triggers", "procedures")

foreach ($name in $files) {
    $path = "db\$name.sql"
    Write-Host "Loading $path ..." -ForegroundColor Cyan
    Get-Content $path | docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" postgres psql -q -v ON_ERROR_STOP=1 -U facetrack -d facetrackdb | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED while loading $path" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Done. Database rebuilt with schema, seed data, triggers and procedures." -ForegroundColor Green
