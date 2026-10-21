// Tiny stand-in process for Discord's Windows game detection under Wine.
// Build: x86_64-w64-mingw32-gcc -Os -s -mwindows -o dummy-game-win.exe dummy-game-win.c
#define UNICODE
#define _UNICODE
#include <windows.h>

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_CLOSE) {
        DestroyWindow(window);
        return 0;
    }
    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(window, message, wparam, lparam);
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command_line, int show_command) {
    (void)previous;
    (void)command_line;
    (void)show_command;
    const wchar_t *class_name = L"OrbsDummyGame";
    WNDCLASSW wc = {0};
    wc.lpfnWndProc = window_proc;
    wc.hInstance = instance;
    wc.lpszClassName = class_name;
    if (!RegisterClassW(&wc)) return 1;

    wchar_t module_path[MAX_PATH];
    DWORD length = GetModuleFileNameW(NULL, module_path, MAX_PATH);
    const wchar_t *title = module_path;
    if (length == 0 || length >= MAX_PATH) title = L"Orbs Dummy Game";
    else for (DWORD i = 0; i < length; i++)
        if (module_path[i] == L'\\' || module_path[i] == L'/') title = module_path + i + 1;

    HWND window = CreateWindowExW(WS_EX_APPWINDOW | WS_EX_NOACTIVATE,
        class_name, title, WS_POPUP | WS_OVERLAPPEDWINDOW,
        -32000, -32000, 1, 1, NULL, NULL, instance, NULL);
    if (!window) return 1;
    ShowWindow(window, SW_SHOWMINNOACTIVE);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
