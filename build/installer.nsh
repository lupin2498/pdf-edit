; Custom NSIS hooks for the PDF Edit installer (included by electron-builder).
!include "WinVer.nsh"

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "PDF Edit cần Windows 10 trở lên.$\r$\nPDF Edit requires Windows 10 or later." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend
