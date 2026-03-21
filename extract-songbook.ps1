$ErrorActionPreference = 'Stop'

$pdfPath = Join-Path $PSScriptRoot 'documents\SongBook.pdf'
$outPath = Join-Path $PSScriptRoot 'documents\SongBook-extracted.md'

$pdfBytes = [System.IO.File]::ReadAllBytes($pdfPath)
$pdfText = [System.Text.Encoding]::ASCII.GetString($pdfBytes)

function Get-ObjectMatch {
    param([int]$ObjectNumber)

    $pattern = "(?ms)(?:^|\r?\n)$ObjectNumber 0 obj\s*(.*?)\s*endobj"
    $match = [regex]::Match($pdfText, $pattern)
    if (-not $match.Success) {
        throw "PDF object $ObjectNumber not found."
    }

    return $match
}

function Get-ObjectBody {
    param([int]$ObjectNumber)

    return (Get-ObjectMatch $ObjectNumber).Groups[1].Value
}

function Get-ObjectStreamText {
    param([int]$ObjectNumber)

    $objectMatch = Get-ObjectMatch $ObjectNumber
    $objectStart = $objectMatch.Index
    $objectLength = $objectMatch.Length
    $objectEnd = $objectStart + $objectLength

    $streamStart = $pdfText.IndexOf('stream', $objectStart)
    if ($streamStart -lt 0 -or $streamStart -gt $objectEnd) {
        return $null
    }

    $streamEnd = $pdfText.IndexOf('endstream', $streamStart)
    if ($streamEnd -lt 0 -or $streamEnd -gt $objectEnd) {
        return $null
    }

    $dataStart = $streamStart + 6
    while ($pdfBytes[$dataStart] -eq 10 -or $pdfBytes[$dataStart] -eq 13) {
        $dataStart++
    }

    $dataEnd = $streamEnd - 1
    while ($pdfBytes[$dataEnd] -eq 10 -or $pdfBytes[$dataEnd] -eq 13) {
        $dataEnd--
    }

    $dataLength = $dataEnd - $dataStart + 1
    $streamBytes = [byte[]]::new($dataLength)
    [Array]::Copy($pdfBytes, $dataStart, $streamBytes, 0, $dataLength)

    $memory = [System.IO.MemoryStream]::new()
    $memory.Write($streamBytes, 2, $streamBytes.Length - 2)
    $memory.Position = 0

    $deflate = [System.IO.Compression.DeflateStream]::new($memory, [System.IO.Compression.CompressionMode]::Decompress)
    $reader = [System.IO.StreamReader]::new($deflate)

    try {
        return $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
        $deflate.Dispose()
        $memory.Dispose()
    }
}

function Get-ToUnicodeMap {
    param([int]$ObjectNumber)

    $map = @{}
    $cmap = Get-ObjectStreamText $ObjectNumber

    foreach ($match in [regex]::Matches($cmap, '<([0-9A-F]+)>\s*<([0-9A-F]+)>')) {
        $source = $match.Groups[1].Value.ToUpper()
        $target = $match.Groups[2].Value
        $chars = [System.Collections.Generic.List[char]]::new()

        if (($target.Length % 4) -eq 0) {
            for ($i = 0; $i -lt $target.Length; $i += 4) {
                $chars.Add([char][Convert]::ToInt32($target.Substring($i, 4), 16))
            }
        }
        else {
            for ($i = 0; $i -lt $target.Length; $i += 2) {
                $chars.Add([char][Convert]::ToInt32($target.Substring($i, 2), 16))
            }
        }

        $map[$source] = -join $chars
    }

    return $map
}

function Decode-HexString {
    param(
        [string]$Hex,
        [hashtable]$Map
    )

    $builder = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt $Hex.Length; $i += 2) {
        $code = $Hex.Substring($i, 2).ToUpper()
        if ($Map.ContainsKey($code)) {
            [void]$builder.Append($Map[$code])
        }
    }

    return $builder.ToString()
}

function Decode-OutlineTitle {
    param([string]$Hex)

    $chars = [System.Collections.Generic.List[char]]::new()
    for ($i = 0; $i -lt $Hex.Length; $i += 4) {
        $chars.Add([char][Convert]::ToInt32($Hex.Substring($i, 4), 16))
    }

    return (-join $chars).Trim()
}

function Get-OrderedLines {
    param(
        [System.Collections.Generic.List[object]]$Runs,
        [string]$Title
    )

    $filteredRuns = $Runs | Where-Object {
        $_.Text.Trim().ToLowerInvariant() -ne $Title.Trim().ToLowerInvariant()
    }

    if (-not $filteredRuns) {
        return @()
    }

    $columnCandidates = $filteredRuns | Where-Object { $_.X -lt 600 } | Sort-Object X
    $splitPoint = $null
    $largestGap = 0.0

    for ($i = 1; $i -lt $columnCandidates.Count; $i++) {
        $gap = [double]$columnCandidates[$i].X - [double]$columnCandidates[$i - 1].X
        if ($gap -gt $largestGap) {
            $largestGap = $gap
            $splitPoint = ([double]$columnCandidates[$i].X + [double]$columnCandidates[$i - 1].X) / 2.0
        }
    }

    if ($largestGap -ge 140 -and $null -ne $splitPoint) {
        $leftColumn = $filteredRuns | Where-Object { $_.X -lt $splitPoint }
        $rightColumn = $filteredRuns | Where-Object { $_.X -ge $splitPoint }

        if ($leftColumn.Count -ge 4 -and $rightColumn.Count -ge 4) {
            $ordered = [System.Collections.Generic.List[string]]::new()

            foreach ($run in ($leftColumn | Sort-Object @{ Expression = 'Y'; Descending = $true }, @{ Expression = 'X'; Descending = $false })) {
                $ordered.Add($run.Text)
            }

            $ordered.Add('')

            foreach ($run in ($rightColumn | Sort-Object @{ Expression = 'Y'; Descending = $true }, @{ Expression = 'X'; Descending = $false })) {
                $ordered.Add($run.Text)
            }

            return $ordered
        }
    }

    return $filteredRuns |
        Sort-Object @{ Expression = 'Y'; Descending = $true }, @{ Expression = 'X'; Descending = $false } |
        ForEach-Object { $_.Text }
}

$pageTree = Get-ObjectBody 502
$pageObjectNumbers = [regex]::Matches($pageTree, '(\d+) 0 R') |
    ForEach-Object { [int]$_.Groups[1].Value }

$fontMaps = @{
    F1 = Get-ToUnicodeMap 506
    F2 = Get-ToUnicodeMap 511
}

$outlineEntries = [regex]::Matches(
    $pdfText,
    '(?ms)(?:^|\r?\n)(\d+) 0 obj\s*<</Count 0/Title<FEFF([0-9A-F]+)>\s*/Dest\[(\d+) 0 R/XYZ'
) | ForEach-Object {
    $pageObjectNumber = [int]$_.Groups[3].Value
    [pscustomobject]@{
        Title = Decode-OutlineTitle $_.Groups[2].Value
        PageObjectNumber = $pageObjectNumber
        PageIndex = [Array]::IndexOf($pageObjectNumbers, $pageObjectNumber) + 1
    }
} | Sort-Object PageIndex

$songSections = [System.Collections.Generic.List[string]]::new()
$songSections.Add('# SongBook Extraction')
$songSections.Add('')
$songSections.Add("Generated from `SongBook.pdf` on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss').")
$songSections.Add('')

foreach ($entry in $outlineEntries) {
    $pageBody = Get-ObjectBody $entry.PageObjectNumber
    $contentMatch = [regex]::Match($pageBody, '/Contents\s+(\d+) 0 R')
    if (-not $contentMatch.Success) {
        continue
    }

    $contentObjectNumber = [int]$contentMatch.Groups[1].Value
    $contentStream = Get-ObjectStreamText $contentObjectNumber
    if (-not $contentStream) {
        continue
    }

    $textRuns = [System.Collections.Generic.List[object]]::new()

    foreach ($blockMatch in [regex]::Matches($contentStream, '(?s)BT\s*(.*?)\s*ET')) {
        $block = $blockMatch.Groups[1].Value
        $positionMatch = [regex]::Match($block, '([-\d\.]+)\s+([-\d\.]+)\s+Td')
        $fontMatch = [regex]::Match($block, '/(F\d+)\s+[-\d\.]+\s+Tf')

        $x = if ($positionMatch.Success) { [double]$positionMatch.Groups[1].Value } else { 0.0 }
        $y = if ($positionMatch.Success) { [double]$positionMatch.Groups[2].Value } else { 0.0 }
        $fontName = if ($fontMatch.Success) { $fontMatch.Groups[1].Value } else { 'F1' }
        $fontMap = $fontMaps[$fontName]

        $decoded = [System.Text.StringBuilder]::new()
        foreach ($hexMatch in [regex]::Matches($block, '<([0-9A-F]+)>')) {
            [void]$decoded.Append((Decode-HexString $hexMatch.Groups[1].Value $fontMap))
        }

        $text = $decoded.ToString().TrimEnd()
        if ($text.Trim().Length -eq 0) {
            continue
        }

        $textRuns.Add([pscustomobject]@{
            X = $x
            Y = $y
            Text = $text
        })
    }

    $lines = Get-OrderedLines -Runs $textRuns -Title $entry.Title

    $songSections.Add("## $($entry.Title)")
    $songSections.Add('')
    $songSections.Add('```text')
    foreach ($line in $lines) {
        $songSections.Add($line)
    }
    $songSections.Add('```')
    $songSections.Add('')
}

[System.IO.File]::WriteAllLines($outPath, $songSections)
Write-Output "Wrote $outPath"
