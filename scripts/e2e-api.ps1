# Liquifact Backend E2E Smoke Test Orchestrator (PowerShell)
# Requirements: docker, node, npm

$ErrorActionPreference = "Stop"

# Configuration
$ComposeFile = "docker-compose.e2e.yml"
$ApiHealthUrl = "http://localhost:3001/health"
$MaxWaitSeconds = 60

function Cleanup {
    Write-Host "Cleaning up containers..."
    docker compose -f $ComposeFile down -v
}

# Register cleanup
# Note: PowerShell doesn't have a direct equivalent to 'trap cleanup EXIT' in all contexts, 
# but we'll use a try/finally block.

try {
    Write-Host "🚀 Starting E2E environment..."
    docker compose -f $ComposeFile up -d --build

    Write-Host "⏳ Waiting for API to be healthy..."
    $StartTime = Get-Date
    $Healthy = $false
    while (((Get-Date) - $StartTime).TotalSeconds -lt $MaxWaitSeconds) {
        try {
            $response = Invoke-WebRequest -Uri $ApiHealthUrl -Method Head -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                $Healthy = $true
                break
            }
        } catch {
            # Continue waiting
        }
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 2
    }

    if (-not $Healthy) {
        Write-Host "`n❌ Timeout waiting for API to become healthy"
        docker compose -f $ComposeFile logs api
        exit 1
    }

    Write-Host "`n ✅ API is healthy!"

    Write-Host "🧪 Running E2E smoke tests..."
    $env:JWT_SECRET = "supersecret-test-token-key-32-chars-long"
    npm run test:e2e
    
    Write-Host "🎉 E2E Smoke Tests Passed Successfully!"
} finally {
    Cleanup
}
