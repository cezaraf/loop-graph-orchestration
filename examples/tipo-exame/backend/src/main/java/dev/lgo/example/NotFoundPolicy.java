package dev.lgo.example;
/** Pure Java policy executed by the offline oracle and used by the REST advice. */
public final class NotFoundPolicy {
 private NotFoundPolicy() {}
 public static int status(){return 404;}
}
