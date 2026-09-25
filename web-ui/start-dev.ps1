param($workdir)
Set-Location $workdir
& npx next dev --hostname 0.0.0.0 --port 3001
