#import "EOPlatformWebKit.h"

@implementation EOPlatformWebKit

+ (void)createPDFInWebView:(WKWebView *)webView
                    rect:(CGRect)rect
              completion:(void (^)(NSData * _Nullable, NSError * _Nullable))completion {
    WKPDFConfiguration *configuration = [[WKPDFConfiguration alloc] init];
    configuration.rect = rect;
    [webView createPDFWithConfiguration:configuration completionHandler:completion];
}

+ (void)evaluateAsyncInWebView:(WKWebView *)webView
                        body:(NSString *)body
                   arguments:(NSDictionary<NSString *, id> *)arguments
                  completion:(void (^)(id _Nullable, NSError * _Nullable))completion {
    [webView callAsyncJavaScript:body
                     arguments:arguments
                       inFrame:nil
                inContentWorld:WKContentWorld.pageWorld
             completionHandler:completion];
}

@end
