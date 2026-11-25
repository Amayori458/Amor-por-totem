# Baixa o cloudflared (programa oficial da Cloudflare que abre o tunel para a internet)
# para a pasta "runtime" do totem. Nao instala nada no Windows.
# Para atualizar no futuro: apague runtime\cloudflared.exe e abra o totem de novo.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$arq = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
$destino = Join-Path $PSScriptRoot 'runtime'
$novo = Join-Path $destino 'cloudflared-novo.exe'
$exe = Join-Path $destino 'cloudflared.exe'

New-Item -ItemType Directory -Force -Path $destino | Out-Null
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arq.exe" -OutFile $novo -UseBasicParsing

# Se o arquivo vier com assinatura digital, ela precisa ser valida e da Cloudflare.
$assinatura = Get-AuthenticodeSignature -FilePath $novo
if ($assinatura.Status -ne 'NotSigned') {
    $dono = if ($assinatura.SignerCertificate) { $assinatura.SignerCertificate.Subject } else { '' }
    if ($assinatura.Status -ne 'Valid' -or $dono -notmatch 'Cloudflare') {
        Remove-Item -Force $novo
        throw 'A assinatura digital do cloudflared nao confere.'
    }
}
Move-Item -Force $novo $exe
