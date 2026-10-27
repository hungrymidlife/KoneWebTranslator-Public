param(
    [Parameter(Mandatory = $true)]
    [string]$Marker
)

# KoneWebTranslator Public: WinForms splash, no npm or Python dependencies.
# UTF-8 BOM is required for Korean literals in Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'KoneWebTranslator - Starting'
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.Size = [System.Drawing.Size]::new(470, 208)
    $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#141E2D')
    $form.TopMost = $true
    $form.ShowInTaskbar = $false

    $stripe = New-Object System.Windows.Forms.Panel
    $stripe.Location = [System.Drawing.Point]::new(0, 0)
    $stripe.Size = [System.Drawing.Size]::new(470, 4)
    $stripe.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#45A7F4')
    $form.Controls.Add($stripe)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = 'KoneWebTranslator Studio'
    $title.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#F1F5FA')
    $title.Font = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
    $title.AutoSize = $false
    $title.Location = [System.Drawing.Point]::new(30, 27)
    $title.Size = [System.Drawing.Size]::new(410, 37)
    $form.Controls.Add($title)

    $status = New-Object System.Windows.Forms.Label
    $status.Text = 'Studio를 시작하고 있습니다'
    $status.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#C7D7E7')
    $status.Font = [System.Drawing.Font]::new('Malgun Gothic', 10)
    $status.AutoSize = $false
    $status.Location = [System.Drawing.Point]::new(30, 78)
    $status.Size = [System.Drawing.Size]::new(410, 27)
    $form.Controls.Add($status)

    $progress = New-Object System.Windows.Forms.ProgressBar
    $progress.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
    $progress.MarqueeAnimationSpeed = 26
    $progress.Location = [System.Drawing.Point]::new(30, 118)
    $progress.Size = [System.Drawing.Size]::new(410, 10)
    $form.Controls.Add($progress)

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = '첫 실행이나 업데이트 후에는 빌드로 시간이 더 걸릴 수 있습니다.'
    $hint.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#8EA6BF')
    $hint.Font = [System.Drawing.Font]::new('Malgun Gothic', 8.5)
    $hint.AutoSize = $false
    $hint.Location = [System.Drawing.Point]::new(30, 151)
    $hint.Size = [System.Drawing.Size]::new(415, 25)
    $form.Controls.Add($hint)

    $script:tick = 0
    $script:closed = $false
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 180
    $timer.Add_Tick({
        if ($script:closed) { return }
        if (-not [System.IO.File]::Exists($Marker)) {
            $script:closed = $true
            $form.Close()
            return
        }
        $script:tick++
        $dots = '.' * ([int][math]::Floor($script:tick / 3) % 4)
        $status.Text = 'Studio를 시작하고 있습니다' + $dots
        if ($script:tick % 5 -eq 0) {
            # Actual Tauri window title (studio/src-tauri/tauri.conf.json).
            # Do not close merely because the dev server/port is online.
            $ready = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
                $_.Id -ne $PID -and $_.MainWindowHandle -ne [IntPtr]::Zero -and
                $_.MainWindowTitle -eq 'KoneWebTranslator Studio'
            }).Count -gt 0
            if ($ready) {
                $script:closed = $true
                $form.Close()
            }
        }
    })
    $form.Add_Shown({ $timer.Start() })
    $form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })
    [System.Windows.Forms.Application]::Run($form)
    $form.Dispose()
}
catch {
    # Splash is optional: never prevent the actual Studio launcher from running.
}
