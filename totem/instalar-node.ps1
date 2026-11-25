# Baixa o Node.js portatil para a pasta "runtime" do totem (nao instala nada no Windows).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$versao = 'v22.12.0'
$arq = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
$nome = "node-$versao-win-$arq"
$base = "https://nodejs.org/dist/$versao"
$destino = Join-Path $PSScriptRoot 'runtime'
$zip = Join-Path $destino "$nome.zip"

New-Item -ItemType Directory -Force -Path $destino | Out-Null
Invoke-WebRequest -Uri "$base/$nome.zip" -OutFile $zip -UseBasicParsing

# confere o arquivo com a lista de verificacao publicada pelo nodejs.org
$somas = (New-Object Net.WebClient).DownloadString("$base/SHASUMS256.txt")
$linha = $somas -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($nome)).zip\s*$" } | Select-Object -First 1
if (-not $linha) { throw 'Nao encontrei a soma de verificacao do Node.js.' }
$esperado = ($linha.Trim() -split '\s+')[0]
$obtido = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash
if ($obtido -ne $esperado) { Remove-Item $zip; throw 'O download do Node.js veio corrompido.' }

$pasta = Join-Path $destino 'node'
if (Test-Path $pasta) { Remove-Item -Recurse -Force $pasta }
Expand-Archive -Path $zip -DestinationPath $destino -Force
Rename-Item -Path (Join-Path $destino $nome) -NewName 'node'
Remove-Item $zip
Write-Host '  Node.js pronto.'
