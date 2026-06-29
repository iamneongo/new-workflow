'use client';

import React, { useCallback, useEffect, useRef } from 'react';

type AppTourProps = {
  selectedAutomationId: string | null;
  hasAutomations: boolean;
  activeWorkflowNode: WorkflowNodeKey | null;
};

type WorkflowNodeKey = 'source' | 'approval' | 'reject' | 'supply' | 'supplyChange' | 'delivery' | 'final';

type TourStep = {
  element?: string;
  popover: {
    title: string;
    description: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    popoverClass?: string;
    showButtons?: Array<'next' | 'previous' | 'close'>;
  };
  disableActiveInteraction?: boolean;
};

const TOUR_SEEN_KEY = 'telegram-bot-tracker-tour-seen-v3';

export default function AppTour({
  selectedAutomationId,
  hasAutomations,
  activeWorkflowNode,
}: AppTourProps) {
  const driverRef = useRef<any>(null);
  const tourPhaseRef = useRef<'idle' | 'intro' | 'workflow' | 'done'>('idle');
  const tourNodeRef = useRef<WorkflowNodeKey | null>(null);

  const destroyTour = useCallback((markSeen: boolean) => {
    if (typeof window !== 'undefined') {
      if (markSeen) {
        window.localStorage.setItem(TOUR_SEEN_KEY, '1');
      }
    }

    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
    tourNodeRef.current = null;
    if (markSeen) {
      tourPhaseRef.current = 'done';
    }
  }, []);

  const pushStep = useCallback((steps: TourStep[], selector: string, step: Omit<TourStep, 'element'>) => {
    if (typeof document === 'undefined' || !document.querySelector(selector)) return;
    steps.push({ element: selector, ...step });
  }, []);

  const buildIntroSteps = useCallback((): TourStep[] => {
    const steps: TourStep[] = [];

    pushStep(steps, '#appBrand', {
      popover: {
        title: 'Bảng điều khiển',
        description: 'Bạn sẽ làm hầu hết mọi việc ở đây: tạo quy trình, chọn nhóm, bật bot và xem log khi cần kiểm tra.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#btnBotConfig', {
      popover: {
        title: 'Token bot',
        description: 'Bạn dán token bot vào đây. Nếu chưa có token, các bước phía sau vẫn xem được nhưng bot chưa thể chạy.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#btnSync', {
      popover: {
        title: 'Đồng bộ',
        description: 'Bấm khi bạn vừa thêm nhóm mới, đổi tên topic, hoặc muốn tải lại dữ liệu Telegram mới nhất.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#btnLogout', {
      popover: {
        title: 'Đăng xuất',
        description: 'Dùng khi bạn muốn đăng nhập lại tài khoản Telegram từ đầu.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#runtimeLogToggle', {
      popover: {
        title: 'Runtime log',
        description: 'Mở phần này khi bạn muốn biết bot đang làm tới đâu, có lỗi gì, hay đang dừng ở bước nào.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#createAutomationButton', {
      popover: {
        title: 'Tạo automation',
        description: 'Mỗi công trình hoặc mỗi luồng làm việc nên có một automation riêng để dễ quản lý.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#searchInput', {
      popover: {
        title: 'Tìm nhanh',
        description: 'Gõ vài chữ để tìm nhanh automation bạn cần mở.',
        side: 'right',
        align: 'start',
      },
    });

    if (hasAutomations) {
      pushStep(steps, '#automationList', {
        popover: {
          title: 'Danh sách automation',
          description: 'Chọn một automation trong danh sách để mở phần cấu hình chi tiết ở bên phải.',
          side: 'right',
          align: 'start',
          showButtons: ['close'],
        },
      });
    }

    pushStep(steps, '#detailsSection', {
      popover: {
        title: 'Khu cấu hình',
        description: 'Khu này hiển thị tên automation, nút bật bot và toàn bộ các bước trong quy trình.',
        side: 'left',
        align: 'start',
      },
    });

    return steps;
  }, [hasAutomations, pushStep]);

  const buildWorkflowSteps = useCallback((): TourStep[] => {
    const steps: TourStep[] = [];

    pushStep(steps, '#detailsSection', {
      popover: {
        title: 'Khu cấu hình',
        description: 'Bạn bấm vào từng node ở đây để chỉnh cấu hình. Mỗi node là một bước thật trong quy trình.',
        side: 'left',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-automation-name', {
      popover: {
        title: 'Đổi tên',
        description: 'Đặt tên rõ ràng theo công trình hoặc mục đích để sau này nhìn vào là biết ngay.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-listener-toggle', {
      popover: {
        title: 'Bật bot theo dõi',
        description: 'Khi các bước cơ bản đã xong, bạn bấm nút này để bot bắt đầu nghe tin nhắn mới.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-workflow-canvas', {
      popover: {
        title: 'Sơ đồ quy trình',
        description: 'Bạn có thể kéo để xem toàn sơ đồ, phóng to hoặc thu nhỏ, rồi bấm vào từng bước để chỉnh.',
        side: 'left',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-source', {
      popover: {
        title: 'Bước 1: Nhóm nguồn',
        description: 'Bước này chọn nơi bot sẽ nghe tin nhắn đầu vào. Bạn chọn đúng nhóm và đúng topic ngay từ đây.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-approval', {
      popover: {
        title: 'Bước 2: Gửi sang nhóm duyệt',
        description: 'Bước này gửi tin sang nhóm duyệt. Bạn chọn nơi nhận và cách bot gửi nội dung gốc sang đó.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-reject', {
      popover: {
        title: 'Nhánh từ chối',
        description: 'Nếu người duyệt bấm không đồng ý, bot sẽ đi theo nhánh này để báo lại đúng nơi bạn đã chọn.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-supply', {
      popover: {
        title: 'Bước 3: Chọn nhà cung ứng',
        description: 'Bước này dùng để chọn nhà cung ứng. Bạn có thể tạo nhiều nhà cung ứng và gắn từng bên vào đúng nhóm riêng.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-supply-change', {
      popover: {
        title: 'Nhánh báo đổi vật tư',
        description: 'Nếu nhà cung ứng muốn đổi vật tư hoặc không thể cấp đúng hàng, bot sẽ báo lại qua nhánh này.',
        side: 'right',
        align: 'start',
      },
    });
    pushStep(steps, '#tour-supply-change-editor', {
      popover: {
        title: 'Chọn nơi nhận báo đổi',
        description: 'Bạn chọn nơi sẽ nhận tin báo đổi vật tư, rồi chọn kiểu gửi lại nội dung để người xem dễ theo dõi.',
        side: 'top',
        align: 'start',
      },
    });
    pushStep(steps, '#tour-supply-change-message-mode', {
      popover: {
        title: 'Chọn cách gửi',
        description: 'Gửi nguyên sẽ giữ mạch tin như cũ. Sao chép hợp hơn khi tin có ảnh, file, hoặc bạn muốn tạo một tin mới rõ ràng hơn.',
        side: 'top',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-delivery', {
      popover: {
        title: 'Bước 4: Báo đã nhận vật tư',
        description: 'Bước này gửi tin báo hàng đang về và chờ người ở công trình reply lại khi đã nhận.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-final', {
      popover: {
        title: 'Bước 5: Chốt nghiệm thu',
        description: 'Đây là bước cuối. Bot sẽ gửi phần xác nhận nghiệm thu sang nơi bạn đã chọn.',
        side: 'right',
        align: 'start',
      },
    });

    return steps;
  }, [pushStep]);

  const buildNodeSteps = useCallback((node: WorkflowNodeKey): TourStep[] => {
    const steps: TourStep[] = [];

    if (node === 'source') {
      pushStep(steps, '#tour-node-source', {
        popover: {
          title: 'Bước 1: Nhóm nguồn',
          description: 'Bạn chọn đúng nhóm ở đây để bot nghe đúng chỗ. Nếu nhóm có nhiều topic, bạn có thể chọn một hoặc nhiều topic cùng lúc.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-source-editor', {
        popover: {
          title: 'Cách dùng node nguồn',
          description: 'Bạn chọn nhóm trước, rồi chọn topic nếu cần. Nếu để trống phần topic, bot sẽ nghe toàn bộ nhóm. Phần nâng cao bên dưới giúp bot chỉ nhận những tin đúng mẫu như CT, Buổi, HM.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-source-recognition-enabled', {
        popover: {
          title: 'Bật lọc tin đúng mẫu',
          description: 'Bạn bật mục này khi chỉ muốn bot nhận những tin đúng mẫu của đội mình. Cách này giúp bot bớt nghe nhầm các tin trò chuyện thông thường.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-source-recognition-keywords', {
        popover: {
          title: 'Nhập dấu hiệu nhận dạng',
          description: 'Bạn nhập các chữ mà tin bắt buộc phải có, ví dụ CT, Buổi, HM. Khi một tin thiếu một trong các chữ này, bot sẽ bỏ qua.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-topic-multi-source', {
        popover: {
        title: 'Chọn nhiều chủ đề',
        description: 'Bạn tick vào những topic muốn nghe. Chọn tất cả sẽ bật hết. Bỏ chọn sẽ xóa hết lựa chọn hiện tại.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'approval') {
      pushStep(steps, '#tour-node-approval', {
        popover: {
          title: 'Bước 2: Gửi sang nhóm duyệt',
          description: 'Bot sẽ gửi tin sang nhóm duyệt ở bước này. Người nhận sẽ bấm Đồng ý hoặc Không đồng ý ngay trên tin.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-approval-editor', {
        popover: {
          title: 'Cách dùng node duyệt',
          description: 'Bạn chọn nơi nhận tin duyệt, chọn cách gửi, rồi chỉnh lời nhắn và nút bấm nếu muốn. Những phần mở rộng như tin nhắn mẫu hay cấu hình theo topic đều nằm trong phần chi tiết.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-approval-message-mode', {
        popover: {
          title: 'Forward hay copy',
          description: 'Gửi nguyên giữ cảm giác như đang xem đúng tin gốc. Sao chép hợp hơn khi bạn muốn nhóm nhận thấy đó là một tin mới, đủ nội dung, dễ xử lý.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-approval-custom-message', {
        popover: {
          title: 'Lời nhắn thêm',
          description: 'Đây là dòng mở đầu để người duyệt nhìn vào là hiểu phải làm gì. Bạn nên viết ngắn, rõ, đúng cách gọi quen thuộc của đội mình.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'reject') {
      pushStep(steps, '#tour-node-reject', {
        popover: {
          title: 'Nhánh từ chối',
          description: 'Nhánh này chỉ chạy khi người duyệt từ chối. Bot sẽ dừng quy trình và báo lại đúng nhóm bạn đã cài.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-reject-editor', {
        popover: {
          title: 'Cách dùng nhánh từ chối',
          description: 'Bạn chọn nơi sẽ nhận tin báo từ chối. Nếu nhóm có topic, nên chọn sẵn để tin không rơi sai chỗ.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'reject') {
      pushStep(steps, '#tour-reject-extra-controls', {
        popover: {
          title: 'Phần nội dung từ chối',
          description: 'Ngay dưới phần chọn nhóm là khu chỉnh nội dung. Từ đây bạn có thể mở sâu hơn để sửa mẫu tin và nội dung riêng cho từng topic nguồn.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-reject-open-message', {
        popover: {
          title: 'Mở phần chi tiết',
          description: 'Bấm nút này để chỉnh kỹ nội dung thông báo từ chối thay vì chỉ xem nhanh ở node.',
          side: 'left',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-reject-message-preview', {
        popover: {
          title: 'Xem nhanh mẫu đang dùng',
          description: 'Khung này cho bạn xem nhanh mẫu tin từ chối hiện tại trước khi mở phần chỉnh sửa đầy đủ.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-reject-custom-message', {
        popover: {
          title: 'Mẫu từ chối mặc định',
          description: 'Đây là mẫu chung bot sẽ dùng khi topic đó chưa có nội dung riêng. Bạn có thể chèn tên người duyệt, người gửi và nội dung gốc vào đây.',
          side: 'left',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-reject-topic-configs', {
        popover: {
          title: 'Nội dung riêng theo topic',
          description: 'Nếu mỗi topic nguồn cần một cách báo từ chối khác nhau, bạn chỉnh riêng tại khu này để bot gửi đúng ngữ cảnh hơn.',
          side: 'left',
          align: 'start',
        },
      });
    }

    if (node === 'supply') {
      pushStep(steps, '#tour-node-supply', {
        popover: {
          title: 'Bước 3: Chọn nhà cung ứng',
          description: 'Đây là bước bot hỏi nhà cung ứng. Bạn có thể gắn nhiều nhà cung ứng khác nhau cho cùng một công trình.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supply-editor', {
        popover: {
          title: 'Cách dùng node vật tư',
          description: 'Bạn chọn nơi bot theo dõi phản hồi của bước này, rồi thêm từng nhà cung ứng bên dưới. Mỗi nhà cung ứng có thể đi vào một nhóm hoặc một topic riêng.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-route-1', {
        popover: {
          title: 'Nhà cung ứng đầu tiên',
          description: 'Mỗi thẻ là một nhà cung ứng. Bạn đặt tên dễ nhớ, chọn nơi nhận tin, rồi chọn kiểu gửi nội dung cho bên đó.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-route-name-1', {
        popover: {
          title: 'Đặt tên nhà cung ứng',
          description: 'Bạn đặt tên quen thuộc để khi nhìn vào danh sách là biết ngay đây là bên nào.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-route-mode-1', {
        popover: {
          title: 'Chọn cách gửi',
          description: 'Gửi nguyên hợp khi bạn muốn giữ mạch tin cũ. Sao chép hợp khi bạn muốn bên nhà cung ứng nhận một tin mới, rõ ràng hơn.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-routes-section', {
        popover: {
          title: 'Danh sách nhà cung ứng',
          description: 'Phần này quản lý toàn bộ danh sách nhà cung ứng của automation. Bạn thêm, sửa, đổi thứ tự hay xóa từng bên ngay tại đây.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-add-supplier-route', {
        popover: {
          title: 'Thêm nhà cung ứng',
          description: 'Khi công trình có thêm nhà cung ứng mới, bạn bấm nút này để thêm một dòng mới rồi điền thông tin cho bên đó.',
          side: 'left',
          align: 'start',
        },
      });
    }

    if (node === 'supplyChange') {
      pushStep(steps, '#tour-node-supply-change', {
        popover: {
          title: 'Nhánh báo đổi vật tư',
          description: 'Bước này xử lý trường hợp nhà cung ứng muốn đổi vật tư. Bot sẽ gom phản hồi và báo lại về nơi bạn đã cài.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supply-change-editor', {
        popover: {
          title: 'Cách dùng nhánh đổi vật tư',
          description: 'Bạn chọn nơi sẽ nhận tin báo đổi vật tư. Đặt đúng topic theo công trình sẽ giúp người xem xử lý nhanh hơn.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supply-change-message-mode', {
        popover: {
          title: 'Chọn cách gửi',
          description: 'Gửi nguyên sẽ bám theo mạch tin cũ. Sao chép sẽ tạo một tin mới rõ ràng hơn cho nhóm nhận.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'delivery') {
      pushStep(steps, '#tour-node-delivery', {
        popover: {
          title: 'Bước 4: Báo đã nhận vật tư',
          description: 'Bước này dùng lúc hàng đã về công trình. Bot sẽ gửi một tin báo nhận hàng và chờ người dùng reply lại ngay trên tin đó.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-delivery-editor', {
        popover: {
          title: 'Cách dùng node giao nhận',
          description: 'Bạn chọn nơi sẽ nhận tin báo giao hàng. Chọn đúng topic sẽ giúp bot hiểu reply đó thuộc công trình nào.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'final') {
      pushStep(steps, '#tour-node-final', {
        popover: {
          title: 'Bước 5: Chốt nghiệm thu',
          description: 'Đây là bước chốt cuối của quy trình. Khi có reply nghiệm thu, bot sẽ gửi tiếp sang nơi bạn đã chọn.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-final-editor', {
        popover: {
          title: 'Cách dùng node nghiệm thu',
          description: 'Bạn chọn nơi nhận kết quả cuối, rồi chọn kiểu gửi cho phù hợp. Nếu đội bạn cần cách viết riêng, bạn chỉnh phần tin nhắn ngay trong bước này.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-final-message-mode', {
        popover: {
          title: 'Kiểu gửi kết quả cuối',
          description: 'Gửi nguyên giữ nguyên reply gốc. Sao chép hợp khi reply có ảnh, file hoặc bạn muốn nhóm nhận thấy đó là một tin mới.',
          side: 'top',
          align: 'start',
        },
      });
    }

    pushStep(steps, `#tour-selector-actions-${node}`, {
      popover: {
        title: 'Lưu lại',
        description: 'Sau khi chỉnh xong, bạn bấm Lưu để hệ thống ghi nhớ thay đổi. Nếu bot đang chạy, hệ thống sẽ tự nạp lại cấu hình mới.',
        side: 'top',
        align: 'start',
      },
    });

    return steps;
  }, [pushStep]);

  const startNodeTour = useCallback(async (node: WorkflowNodeKey) => {
    if (typeof window === 'undefined') return;

    const steps = buildNodeSteps(node);
    if (!steps.length) return;

    const { driver } = await import('driver.js');

    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }

    tourPhaseRef.current = 'workflow';
    tourNodeRef.current = node;

    const instance = driver({
      steps,
      animate: true,
      showProgress: true,
      overlayColor: '#111827',
      overlayOpacity: 0.58,
      smoothScroll: true,
      allowScroll: false,
      allowClose: true,
      allowKeyboardControl: true,
      stagePadding: 12,
      stageRadius: 18,
      popoverClass: 'app-tour-popover',
      nextBtnText: 'Tiếp',
      prevBtnText: 'Quay lại',
      doneBtnText: 'Xong',
      onHighlightStarted: (element) => {
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      },
      onCloseClick: () => destroyTour(true),
      onDoneClick: () => destroyTour(true),
    });

    driverRef.current = instance;
    instance.drive();
  }, [buildNodeSteps, destroyTour]);

  const startTour = useCallback(async (phase: 'intro' | 'workflow') => {
    if (typeof window === 'undefined') return;

    const steps = phase === 'intro' ? buildIntroSteps() : buildWorkflowSteps();
    if (!steps.length) return;

    const { driver } = await import('driver.js');

    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }

    tourPhaseRef.current = phase;
    tourNodeRef.current = null;

    const instance = driver({
      steps,
      animate: true,
      showProgress: true,
      overlayColor: '#111827',
      overlayOpacity: 0.58,
      smoothScroll: true,
      allowScroll: false,
      allowClose: true,
      allowKeyboardControl: true,
      stagePadding: 12,
      stageRadius: 18,
      popoverClass: 'app-tour-popover',
      nextBtnText: 'Tiếp',
      prevBtnText: 'Quay lại',
      doneBtnText: 'Xong',
      onHighlightStarted: (element) => {
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      },
      onCloseClick: () => destroyTour(true),
      onDoneClick: () => destroyTour(true),
    });

    driverRef.current = instance;
    instance.drive();
  }, [buildIntroSteps, buildWorkflowSteps, destroyTour]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (tourPhaseRef.current !== 'intro') return;
    if (!selectedAutomationId) return;
    if (!driverRef.current?.isActive?.()) return;

    const timer = window.setTimeout(() => {
      destroyTour(false);
      if (activeWorkflowNode) {
        void startNodeTour(activeWorkflowNode);
        return;
      }
      void startTour('workflow');
    }, 300);

    return () => window.clearTimeout(timer);
  }, [activeWorkflowNode, destroyTour, selectedAutomationId, startNodeTour, startTour]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (tourPhaseRef.current !== 'workflow') return;
    if (!activeWorkflowNode) return;
    if (!driverRef.current?.isActive?.()) return;
    if (tourNodeRef.current === activeWorkflowNode) return;

    const timer = window.setTimeout(() => {
      destroyTour(false);
      void startNodeTour(activeWorkflowNode);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [activeWorkflowNode, destroyTour, startNodeTour]);

  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, []);

  return (
    <button
      type="button"
      id="btnAppTour"
      className="btn btn-secondary"
      onClick={() => void (async () => {
        if (!selectedAutomationId) {
          await startTour('intro');
          return;
        }
        if (activeWorkflowNode) {
          await startNodeTour(activeWorkflowNode);
          return;
        }
        await startTour('workflow');
      })()}
      style={{ border: '1px solid rgba(17, 24, 39, 0.12)', background: 'rgba(255,255,255,0.03)' }}
      title="Mở hướng dẫn"
    >
      <i className="fa-solid fa-circle-question" />
      Hướng dẫn
    </button>
  );
}
