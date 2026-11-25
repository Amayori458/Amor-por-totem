# Imprime fotos direto pelo Windows, sem passar pelo navegador: escolhe a impressora
# pelo nome e o papel pela medida, entre os papeis que o driver oferece.
#
# Entrada (variaveis de ambiente):
#   TOTEM_IMPRESSORA   nome da impressora (vazio = padrao do Windows)
#   TOTEM_LARGURA_MM   lado menor do papel, em mm
#   TOTEM_ALTURA_MM    lado maior do papel, em mm
#   TOTEM_TRABALHO     arquivo JSON: [{"arquivo":"C:\\...\\001.jpg","copias":2}, ...]
#   TOTEM_SO_PAPEIS    "1" = so lista os papeis do driver, nao imprime
# Saida: uma linha JSON. "fase" diz se a falha foi antes ("preparo") ou depois
# ("impressao") de mandar algo para a impressora.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$fase = 'preparo'

function Responder($dados) {
    $dados | ConvertTo-Json -Compress -Depth 5 | Write-Output
}

try {
    Add-Type -AssemblyName System.Drawing
    $doc = New-Object System.Drawing.Printing.PrintDocument
    if ($env:TOTEM_IMPRESSORA) { $doc.PrinterSettings.PrinterName = $env:TOTEM_IMPRESSORA }
    if (-not $doc.PrinterSettings.IsValid) {
        Responder @{ ok = $false; fase = $fase; codigo = 'sem-impressora'; erro = 'Impressora nao encontrada no Windows.' }
        exit 0
    }
    $nome = $doc.PrinterSettings.PrinterName

    # medidas do driver vem em centesimos de polegada (x 0.254 = mm)
    $papeis = @()
    foreach ($p in $doc.PrinterSettings.PaperSizes) {
        $papeis += @{ nome = [string]$p.PaperName; largura = [math]::Round($p.Width * 0.254, 1); altura = [math]::Round($p.Height * 0.254, 1) }
    }
    if ($env:TOTEM_SO_PAPEIS -eq '1') {
        Responder @{ ok = $true; impressora = $nome; papeis = $papeis }
        exit 0
    }

    # papel do driver mais proximo da medida pedida (em pe ou deitado), com ate 8 mm de folga
    $lado1 = [double]$env:TOTEM_LARGURA_MM
    $lado2 = [double]$env:TOTEM_ALTURA_MM
    $melhor = $null
    $menor = 100000
    foreach ($p in $doc.PrinterSettings.PaperSizes) {
        $w = $p.Width * 0.254
        $h = $p.Height * 0.254
        $d = [math]::Max([math]::Abs([math]::Min($w, $h) - $lado1), [math]::Abs([math]::Max($w, $h) - $lado2))
        if ($d -lt $menor) { $menor = $d; $melhor = $p }
    }
    if (($null -eq $melhor) -or ($menor -gt 8)) {
        Responder @{ ok = $false; fase = $fase; codigo = 'sem-papel'; erro = 'O driver da impressora nao tem papel nesta medida.'; impressora = $nome; papeis = $papeis }
        exit 0
    }

    $itens = Get-Content -Raw -Encoding UTF8 -Path $env:TOTEM_TRABALHO | ConvertFrom-Json
    $fila = New-Object System.Collections.ArrayList
    foreach ($it in $itens) {
        for ($c = 0; $c -lt [int]$it.copias; $c++) { [void]$fila.Add([string]$it.arquivo) }
    }
    if ($fila.Count -eq 0) {
        Responder @{ ok = $false; fase = $fase; codigo = 'falha'; erro = 'Nenhuma foto para imprimir.' }
        exit 0
    }
    foreach ($arquivo in $fila) {
        if (-not (Test-Path -LiteralPath $arquivo)) { throw "Arquivo nao encontrado: $arquivo" }
    }

    $doc.DocumentName = 'Totem Amor por Fotos'
    $doc.DefaultPageSettings.PaperSize = $melhor
    $doc.DefaultPageSettings.Landscape = $false
    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $doc.OriginAtMargins = $false
    # sem a janelinha "Imprimindo..."
    $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

    $script:indice = 0
    $script:falha = $null
    $doc.add_PrintPage({
        param($remetente, $e)
        try {
            $img = [System.Drawing.Image]::FromFile($fila[$script:indice])
            try {
                $pagina = $e.PageBounds
                # foto e papel na mesma orientacao
                if (($pagina.Width -gt $pagina.Height) -ne ($img.Width -gt $img.Height)) {
                    $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
                }
                # cobre a folha inteira mantendo a proporcao (sem margem)
                $escala = [math]::Max($pagina.Width / $img.Width, $pagina.Height / $img.Height)
                $w = $img.Width * $escala
                $h = $img.Height * $escala
                $x = ($pagina.Width - $w) / 2 - $e.PageSettings.HardMarginX
                $y = ($pagina.Height - $h) / 2 - $e.PageSettings.HardMarginY
                $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $e.Graphics.DrawImage($img, [single]$x, [single]$y, [single]$w, [single]$h)
            } finally {
                $img.Dispose()
            }
        } catch {
            $script:falha = $_.Exception.Message
        }
        $script:indice++
        $e.HasMorePages = ($script:indice -lt $fila.Count) -and ($null -eq $script:falha)
    })

    $fase = 'impressao'
    $doc.Print()
    if ($null -ne $script:falha) { throw $script:falha }
    Responder @{ ok = $true; impressora = $nome; papel = [string]$melhor.PaperName; folhas = $fila.Count }
} catch {
    Responder @{ ok = $false; fase = $fase; codigo = 'falha'; erro = [string]$_.Exception.Message }
}
