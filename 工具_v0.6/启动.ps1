param([switch]$Configure,[string]$InputFile,[switch]$Check,[string]$OutputFile,[switch]$Refresh,[string]$Company,[switch]$NoPreview)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$taskRoot = Split-Path -Parent $PSScriptRoot
function Find-NodeExecutable {
    $searchPaths = @(
        "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
        'C:\Program Files\nodejs\node.exe',
        'C:\Program Files (x86)\nodejs\node.exe'
    )
    if ($env:NODE_PATH) { $searchPaths += "$env:NODE_PATH\node.exe" }
    foreach ($path in $searchPaths) {
        if (Test-Path -LiteralPath $path) {
            Write-Host "✓ 找到Node.js：$path"
            return $path
        }
    }
    try {
        $nodePath = (Get-Command node -ErrorAction Stop).Source
        Write-Host "✓ 找到Node.js：$nodePath"
        return $nodePath
    } catch {}
    throw 'Node.js未找到。请安装Node.js或设置NODE_PATH环境变量。'
}
function Save-TaskSecret([string]$Name,[string]$Prompt) {
    $taskSecret = Read-Host $Prompt -AsSecureString
    if ($taskSecret.Length -eq 0) { return }
    $taskEncrypted = ConvertFrom-SecureString -SecureString $taskSecret
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot ($Name + '.dpapi')), $taskEncrypted, [Text.Encoding]::ASCII)
    Write-Host ($Name + ' 已加密保存，仅当前Windows账户可解密。')
}
function Load-TaskSecret([string]$Name) {
    $taskFile = Join-Path $PSScriptRoot ($Name + '.dpapi')
    if (!(Test-Path -LiteralPath $taskFile)) {
        $taskFile = Join-Path (Join-Path $taskRoot '工具_v0.5') ($Name + '.dpapi')
        if (!(Test-Path -LiteralPath $taskFile)) {
            $taskFile = Join-Path (Join-Path $taskRoot '工具_v0.4') ($Name + '.dpapi')
            if (!(Test-Path -LiteralPath $taskFile)) { return }
            Write-Host "⚠️  正在使用v0.4的密钥文件"
        } else {
            Write-Host "⚠️  正在使用v0.5的密钥文件"
        }
    }
    # Older Set-Content saves include CRLF; DPAPI hex parsing requires a trimmed string.
    $taskEncrypted = [IO.File]::ReadAllText($taskFile).Trim()
    if ([string]::IsNullOrWhiteSpace($taskEncrypted)) {
        throw ($Name + ' 的密钥文件为空，请重新运行”配置接口_v0.6.cmd”。')
    }
    if ($taskEncrypted -notmatch '\A[0-9a-fA-F]+\z' -or ($taskEncrypted.Length % 2) -ne 0) {
        throw ($Name + ' 的加密密钥文件格式损坏，请重新运行”配置接口_v0.6.cmd”；不要手工编辑密钥文件。')
    }
    try { $taskSecure = ConvertTo-SecureString -String $taskEncrypted -ErrorAction Stop }
    catch { throw ($Name + ' 无法由当前Windows账户解密，请在本机重新运行”配置接口_v0.6.cmd”。') }
    $taskPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
    try { [Environment]::SetEnvironmentVariable($Name,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPtr),'Process') }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPtr) }
}
try {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    if ($Configure) {
        Write-Host '========== DeepSeek核保工具 v0.6 配置 =========='
        Write-Host ''
        Write-Host '新版改进：'
        Write-Host '  • 自动检测Node.js路径'
        Write-Host '  • 遵守robots.txt爬虫规范'
        Write-Host '  • 改进错误处理和日志输出'
        Write-Host '  • 优化代码结构'
        Write-Host ''
        Write-Host '隐私提示：'
        Write-Host '  • 公司材料、规则及公开证据将发送给DeepSeek'
        Write-Host '  • 查询词和公开网址会发送给搜索/抓取服务'
        Write-Host '  • API密钥使用Windows DPAPI加密，仅当前账户可解密'
        Write-Host ''
        Save-TaskSecret 'DEEPSEEK_API_KEY' '请输入DeepSeek官方API密钥（隐藏输入；直接回车保留原设置）'
        Write-Host ''
        Write-Host '✓ 配置完成。'
        Write-Host '  下一步：运行”运行核保_DeepSeek_v0.6.cmd”'
        exit 0
    }
    $taskNode = Find-NodeExecutable
    Load-TaskSecret 'DEEPSEEK_API_KEY'
    if (!$InputFile) { $InputFile = Join-Path $taskRoot '测试.xlsx' }
    $taskArgs = @((Join-Path $PSScriptRoot '核保批处理.mjs'),'--root',$taskRoot,'--input',$InputFile)
    if ($Check) { $taskArgs += '--check' }
    if ($OutputFile) { $taskArgs += @('--output',$OutputFile) }
    if ($Refresh) { $taskArgs += '--refresh' }
    if ($Company) { $taskArgs += @('--company',$Company) }
    if ($NoPreview) { $taskArgs += '--no-preview' }
    & $taskNode @taskArgs
    $taskExit = $LASTEXITCODE
    if ($taskExit -eq 0) { Write-Host '✅ 执行完成。' }
    else { Write-Host '⚠️  执行未完全成功。请查看上方错误或运行记录。' }
    exit $taskExit
} catch {
    Write-Host ('❌ 无法继续：' + $_.Exception.Message)
    exit 1
} finally {
    Remove-Item Env:\DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
}
