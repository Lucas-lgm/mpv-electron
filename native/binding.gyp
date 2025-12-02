{
  "targets": [
    {
      "target_name": "mpv_binding",
      "sources": [
        "binding.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "/opt/homebrew/opt/mpv/include",
        "../mpv/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.13"
          },
          "link_settings": {
            "libraries": [
              "/opt/homebrew/opt/mpv/lib/libmpv.dylib",
              "-framework Cocoa",
              "-framework IOKit",
              "-framework QuartzCore"
            ],
            "library_dirs": [
              "/opt/homebrew/opt/mpv/lib"
            ]
          },
          "include_dirs": [
            "/opt/homebrew/opt/mpv/include"
          ]
        }],
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          },
          "link_settings": {
            "libraries": [
              "../mpv/build/libmpv.lib"
            ],
            "library_dirs": [
              "../mpv/build"
            ]
          }
        }],
        ["OS=='linux'", {
          "link_settings": {
            "libraries": [
              "-L../mpv/build",
              "-lmpv",
              "-lpthread"
            ],
            "library_dirs": [
              "../mpv/build"
            ]
          }
        }]
      ]
    }
  ]
}
