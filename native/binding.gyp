{
  "targets": [
    {
      "target_name": "mpv_binding",
      "sources": [
        "binding.cc",
        "mpv_render_gl.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(module_root_dir)/../vendor/mpv/darwin-arm64/include",
        "<(module_root_dir)/../mpv/include"
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
              "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib/libmpv.2.dylib",
              "-framework Cocoa",
              "-framework IOKit",
              "-framework QuartzCore",
              "-framework CoreVideo"
            ],
            "library_dirs": [
              "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib"
            ]
          },
          "include_dirs": [
            "<(module_root_dir)/../vendor/mpv/darwin-arm64/include"
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
