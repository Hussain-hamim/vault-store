-- All arguments are data, never interpolated into AppleScript or shell code.
on findControl(rootElement, wantedRoles, labels)
  tell application "System Events"
    set elements to {rootElement} & (entire contents of rootElement)
    repeat with idx from (count of elements) to 1 by -1
      set el to item idx of elements
      try
        if (role of el) is in wantedRoles then
          set labelText to ""
          try
            set labelText to (description of el) as text
          end try
          try
            if name of el is not missing value then set labelText to labelText & " " & (name of el)
          end try
          if (role of el) is "AXStaticText" then
            try
              if value of el is not missing value then set labelText to labelText & " " & (value of el)
            end try
          end if
          repeat with labelPart in labels
            if labelText contains (contents of labelPart) then return el
          end repeat
        end if
      end try
    end repeat
  end tell
  return missing value
end findControl

on findId(rootElement, wantedId)
  if rootElement is missing value then return missing value
  tell application "System Events"
    try
      if value of attribute "AXIdentifier" of rootElement is wantedId then return rootElement
    end try
    try
      set childElements to UI elements of rootElement
    on error
      return missing value
    end try
  end tell
  repeat with childElement in childElements
    set foundElement to my findId(contents of childElement, wantedId)
    if foundElement is not missing value then return foundElement
  end repeat
  return missing value
end findId

on appProcess()
  return my mainWindow()
end appProcess

on waitId(wantedId, secondsToWait, failureCode)
  set deadline to (current date) + secondsToWait
  repeat
    set el to my findId(my appProcess(), wantedId)
    if el is not missing value then return el
    if (current date) > deadline then error failureCode
    delay 0.2
  end repeat
end waitId

on mainWindow()
  tell application "System Events"
    if not (exists process "WhatsApp") then error "WHATSAPP_CHAT_NOT_READY"
    tell process "WhatsApp"
      if (count of windows) is 0 then return missing value
      set activeWindow to window 1
      try
        repeat while (count of sheets of activeWindow) > 0
          set activeWindow to sheet 1 of activeWindow
        end repeat
      end try
      return activeWindow
    end tell
  end tell
end mainWindow

on focusWhatsApp()
  tell application "System Events" to tell process "WhatsApp" to set frontmost to true
  set deadline to (current date) + 3
  repeat
    tell application "System Events" to set isFront to frontmost of process "WhatsApp"
    if isFront then return
    if (current date) > deadline then error "WHATSAPP_CHAT_NOT_READY"
    delay 0.1
  end repeat
end focusWhatsApp

on replaceText(el, newText)
  my focusWhatsApp()
  tell application "System Events"
    -- AX focus alone is ignored by some Catalyst text controls. Click the
    -- control's actual bounds, then refuse to type unless it owns focus.
    set xy to position of el
    set wh to size of el
    tell process "WhatsApp" to click at {(item 1 of xy) + (item 1 of wh) / 2, (item 2 of xy) + (item 2 of wh) / 2}
    set focusDeadline to (current date) + 3
    repeat until focused of el
      if (current date) > focusDeadline then error "WHATSAPP_ATTACH_FAILED"
      delay 0.1
    end repeat
    set the clipboard to newText
    keystroke "a" using command down
    if newText is "" then
      key code 51
    else
      keystroke "v" using command down
    end if
  end tell
  set deadline to (current date) + 3
  repeat
    tell application "System Events" to set actualText to value of el
    if actualText is newText then return
    if (current date) > deadline then error "WHATSAPP_ATTACH_FAILED"
    delay 0.1
  end repeat
end replaceText

on waitControl(rootElement, wantedRoles, labels, secondsToWait, failureCode)
  set deadline to (current date) + secondsToWait
  repeat
    set el to my findControl(rootElement, wantedRoles, labels)
    if el is not missing value then return el
    if (current date) > deadline then error failureCode
    delay 0.2
  end repeat
end waitControl

on run argv
  set pdfPath to item 1 of argv
  set captionText to read POSIX file (item 2 of argv) as «class utf8»
  set routeText to read POSIX file (item 3 of argv) as «class utf8»
  tell application "System Events" to set fileName to name of disk item pdfPath
  set previousClipboard to the clipboard as record
  try
    tell application "WhatsApp" to activate
    -- Resolve the exact international number in New Chat, scoped to Search
    -- results (old frequently-contacted rows remain in the accessibility tree).
    set newChat to my waitId("NavigationBar_NewChatButton", 15, "WHATSAPP_CHAT_NOT_READY")
    tell application "System Events" to click newChat
    set searchField to my waitId("PickerView_SearchBar", 5, "WHATSAPP_CHAT_NOT_READY")
    my replaceText(searchField, "+" & routeText)
    set deadline to (current date) + 20
    repeat
      set resultGroup to my findControl(my appProcess(), {"AXGroup"}, {"Search results"})
      set contactRows to {}
      if resultGroup is not missing value then
        tell application "System Events"
          repeat with el in (entire contents of resultGroup)
            try
              if (role of el) is "AXGroup" and (value of attribute "AXIdentifier" of el) is "PickerView_ContactCell" then set end of contactRows to contents of el
            end try
          end repeat
        end tell
      end if
      if (count of contactRows) is 1 then exit repeat
      if (current date) > deadline then error "WHATSAPP_CHAT_NOT_READY"
      delay 0.25
    end repeat
    set selectedContact to item 1 of contactRows
    tell application "System Events"
      set contactName to description of selectedContact
      click selectedContact
    end tell
    set deadline to (current date) + 10
    repeat
      set header to my findId(my appProcess(), "NavigationBar_HeaderViewButton")
      if header is not missing value then
        tell application "System Events" to set actualName to description of header
        if actualName is contactName then exit repeat
      end if
      if (current date) > deadline then error "WHATSAPP_CHAT_NOT_READY"
      delay 0.2
    end repeat
    set composer to my waitId("ChatBar_ComposerTextView", 5, "WHATSAPP_CHAT_NOT_READY")
    tell application "System Events" to set existingDraft to value of composer
    if existingDraft is not missing value and existingDraft is not "" then error "WHATSAPP_CHAT_NOT_READY"
    set win to my mainWindow()
    set attachButton to my waitControl(win, {"AXButton", "AXMenuButton"}, {"Share media", "Attach", "پیوست", "ضمیمه"}, 5, "WHATSAPP_ATTACH_FAILED")
    my focusWhatsApp()
    tell application "System Events" to click attachButton
    -- WhatsApp for Mac uses a popover with a File button, not the Windows
    -- Document menu and not a text/file paste into the ordinary composer.
    set deadline to (current date) + 5
    repeat
      set popover to missing value
      tell application "System Events"
        try
          set popover to my findControl(my appProcess(), {"AXPopover"}, {""})
        end try
      end tell
      if popover is not missing value then exit repeat
      if (current date) > deadline then error "WHATSAPP_ATTACH_FAILED"
      delay 0.2
    end repeat
    set fileButton to my waitControl(popover, {"AXButton", "AXMenuItem"}, {"File", "Document", "فایل", "سند"}, 5, "WHATSAPP_ATTACH_FAILED")
    tell application "System Events" to click fileButton
    set deadline to (current date) + 10
    repeat
      set openPanel to missing value
      tell application "System Events"
        try
          set openPanel to my findId(my appProcess(), "open-panel")
        end try
      end tell
      if openPanel is not missing value then exit repeat
      if (current date) > deadline then error "WHATSAPP_ATTACH_FAILED"
      delay 0.2
    end repeat
    my focusWhatsApp()
    tell application "System Events" to keystroke "g" using {command down, shift down}
    set deadline to (current date) + 5
    repeat
      set goPanel to missing value
      tell application "System Events"
        try
          set goPanel to my findId(my appProcess(), "GoToWindow")
        end try
      end tell
      if goPanel is not missing value then exit repeat
      if (current date) > deadline then error "WHATSAPP_ATTACH_FAILED"
      delay 0.2
    end repeat
    set pathField to my waitId("PathTextField", 5, "WHATSAPP_ATTACH_FAILED")
    my replaceText(pathField, pdfPath)
    my focusWhatsApp()
    tell application "System Events" to key code 36
    set deadline to (current date) + 8
    repeat
      set goIsOpen to (my findId(my appProcess(), "GoToWindow")) is not missing value
      if not goIsOpen then exit repeat
      if (current date) > deadline then error "WHATSAPP_ATTACH_FAILED"
      delay 0.2
    end repeat
    set openButton to my waitControl(openPanel, {"AXButton"}, {"Open", "باز", "پرانیستل"}, 5, "WHATSAPP_ATTACH_FAILED")
    tell application "System Events" to click openButton

    -- A caption field only exists in the attachment preview. Never send the
    -- greeting from the ordinary message composer when attachment fails.
    set captionField to my waitControl(my appProcess(), {"AXTextArea", "AXTextField"}, {"caption", "Caption", "شرح", "توضیح"}, 20, "WHATSAPP_ATTACH_FAILED")
    -- Find the smallest shared ancestor containing this caption, filename and
    -- Send. Never fall back to the main chat window / ordinary Send button.
    set preview to captionField
    set sendButton to missing value
    tell application "System Events"
      repeat 12 times
        set preview to parent of preview
        if role of preview is in {"AXWindow", "AXApplication"} then exit repeat
        set filenameLabel to my findControl(preview, {"AXStaticText"}, {fileName})
        set candidateSend to my findControl(preview, {"AXButton"}, {"Send", "ارسال", "لېږل"})
        set ordinaryComposer to my findId(preview, "ChatBar_ComposerTextView")
        if filenameLabel is not missing value and candidateSend is not missing value and ordinaryComposer is missing value then
          set sendButton to candidateSend
          exit repeat
        end if
      end repeat
    end tell
    if sendButton is missing value then error "WHATSAPP_ATTACH_FAILED"
    my replaceText(captionField, captionText)
    my focusWhatsApp()
    -- The ONLY send action, reached only with a verified PDF preview.
    tell application "System Events" to click sendButton
    set deadline to (current date) + 15
    repeat
      set previewCaption to my findControl(my appProcess(), {"AXTextArea", "AXTextField"}, {"caption", "Caption", "شرح", "توضیح"})
      if previewCaption is missing value then
        set messageComposer to my findControl(my appProcess(), {"AXTextArea", "AXTextField"}, {"Compose message", "Type a message", "پیام", "پیغام"})
        if messageComposer is not missing value then exit repeat
      end if
      if (current date) > deadline then error "WHATSAPP_SEND_UNCONFIRMED"
      delay 0.25
    end repeat
    set the clipboard to previousClipboard
    return "RADEFY_WHATSAPP_SUBMITTED"
  on error errorText number errorNumber
    try
      set the clipboard to previousClipboard
    end try
    error errorText number errorNumber
  end try
end run
