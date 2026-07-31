-keep class com.qurancaption.androidmedia.AndroidMediaPlugin { *; }
-keep class com.fasterxml.jackson.databind.ObjectMapper { *; }
-keepclassmembers class * implements org.apache.commons.compress.archivers.zip.ZipExtraField {
    public <init>();
}
