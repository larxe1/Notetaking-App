$dbjs = Get-Content "src/db.js" -Raw
$urlMatch = [regex]::Match($dbjs, 'createClient\([''"]([^''"]+)[''"]')
$keyMatch = [regex]::Match($dbjs, 'createClient\([''"][^''"]+[''"],\s*[''"]([^''"]+)[''"]')

if (-not $urlMatch.Success -or -not $keyMatch.Success) {
    Write-Host "Could not extract credentials"
    exit 1
}

$url = $urlMatch.Groups[1].Value
$key = $keyMatch.Groups[1].Value

$headers = @{
    "apikey" = $key
    "Authorization" = "Bearer $key"
    "Content-Type" = "application/json"
    "Prefer" = "return=representation,resolution=merge-duplicates"
}

$body = @{
    pdf_id = "test-pdf-id"
    content = "test content"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$url/rest/v1/pdf_notes?on_conflict=pdf_id" -Method Post -Headers $headers -Body $body
    Write-Host "Success:"
    $response | ConvertTo-Json
} catch {
    Write-Host "Error details:"
    $_.ErrorDetails.Message
}
